// ── 翻页动画引擎（真实内容过渡 + 5 种效果）────────────────────────
// 核心思路：翻页前后把「当前真实书页(iframe)」截图成图层，
// 用「旧页图层离场」的方式揭示动画期间已经真实切换好的新页。
// 这样手指/动画所见的都是真实书页内容，而非空白纸片。
//
// ⚠️ 对 Safari/WebKit 的关键性能优化：
//   1) html-to-image 依赖 SVG foreignObject，而 foreignObject 无法序列化 iframe 内部的
//      DOM 树。EPUB 书页是 iframe，所以 Safari 下截图必然是「空 iframe 框」。
//   2) 之前的实现每次 turnPage 先等 40ms(SETTLE_DELAY) settle → 再等
//      最长 1200ms CAPTURE_TIMEOUT 超时返回 null → fallback 直接导航。
//      等于每翻一页白白被「截图尝试」阻塞 ~1s，就是用户说的「卡、阻力感」。
//   3) 现在：
//      - 第一次翻页 / 第一次 drag 前做一次 300ms 的截图可行性预检测 probe。
//      - 若 probe 失败，本容器「永久 bypass」(session 级)，再也不截图、不产生 sheet、
//        turnPage 直接返回 false 让调用方导航，没有任何等待。
//      - 若 probe 成功，后续仍走连续失败计数(2 次 → 8s bypass)，双保险。
//      - WebKit 的 SETTLE_DELAY 设 0、CAPTURE_TIMEOUT 设 300ms。
//
// slide: 平滑滑动 (Kindle/微信读书风格)
// fade:  淡入淡出 (安静优雅)
// flip:  仿真翻页 (Apple Books 风格 3D 翻折)
// cover: 覆盖滑动 (iOS 风格)
// curl:  卷页揭页 (Google Play Books 风格)

function detectWebKitLike() {
  const ua = navigator.userAgent || '';
  const platform = (navigator.platform || '');
  const isIOSLike = /iPad|iPhone|iPod/i.test(platform)
    || (platform === 'MacIntel' && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1);
  const isDesktopSafari = /^((?!chrome|crios|android|edg|opr|fxios|fxiOS).)*safari/i.test(ua)
    || ((navigator.vendor || '').includes('Apple') && !/chrome|crios|edg|opr|fxios|fxiOS/i.test(ua));
  return isIOSLike || isDesktopSafari;
}
const IS_WEBKIT_LIKE = detectWebKitLike();

export function isEPUBPageTurnAnimationSupported() {
  return !IS_WEBKIT_LIKE;
}

const ANIMATION_DURATION = 460;
const SETTLE_DELAY = IS_WEBKIT_LIKE ? 0 : 40;
const CAPTURE_TIMEOUT = IS_WEBKIT_LIKE ? 300 : 1200;
const BYPASS_AFTER_FAILS = IS_WEBKIT_LIKE ? 1 : 2; // WebKit 一次失败就进入短暂 bypass
const BYPASS_WINDOW_MS = 8000;
const PROBE_TIMEOUT_MS = IS_WEBKIT_LIKE ? 300 : 800; // 预检测超时
const EFFECTS = ['slide', 'fade', 'cover', 'curl'];
const STORAGE_KEY = 'reader-page-turn-effect';
const DEFAULT_EFFECT = 'slide';

let currentEffect = loadEffect();

const activeContainers = new WeakSet();
const dragStates = new WeakMap();
const captureStats = new WeakMap();      // container → { fails, bypassUntil }
const probeResults = new WeakMap();      // container → 'testing' | 'ok' | 'fail'
const probeCallbacks = new WeakMap();    // container → Promise<boolean>

// WebKit：整个 session 全局只要有任何容器 probe 失败，就全局禁用截图。
// 原因：所有 EPUB 阅读器用的都是同一种 iframe 结构，截图能力一致。
let WEBKIT_GLOBAL_PROBE_KNOWN = false;   // 是否已完成过一次 probe
let WEBKIT_GLOBAL_PROBE_OK = false;      // 结果（true = 有 iframe 的容器也能截到有效图）

// ── 持久化 ──────────────────────────────────────────────────────
function loadEffect() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (EFFECTS.includes(saved)) return saved;
  } catch {}
  return DEFAULT_EFFECT;
}

function saveEffect(effect) {
  try { localStorage.setItem(STORAGE_KEY, effect); } catch {}
}

export function setPageTurnEffect(effect) {
  if (!EFFECTS.includes(effect)) return;
  currentEffect = effect;
  saveEffect(effect);
}

export function getPageTurnEffect() {
  return currentEffect;
}

export function getAvailableEffects() {
  return [...EFFECTS];
}

// ── 截图能力：WebKit 全局预检测 ──────────────────────────────────
// 在任意 turnPage/beginPageDrag 之前，先跑一次 probe：
// 对当前容器里的 iframe 尝试截一次，300ms 内返回一张「有信息量」的图才算成功。
// 「有信息量」判断：dataUrl 长度 > 200 字节（排除空容器全白的 tiny png）。
function dataUrlIsInformative(result) {
  if (!result?.dataUrl) return false;
  if (typeof result.dataUrl !== 'string') return false;
  if (!result.dataUrl.startsWith('data:image/')) return false;
  // data:image/png;base64,....  →  base64 长度 ≈ (像素*4/3)，但 200 字节只是「一张真图」的下限
  return result.dataUrl.length > 220;
}

async function runProbe(container) {
  // 已知全局结果：直接返回
  if (IS_WEBKIT_LIKE && WEBKIT_GLOBAL_PROBE_KNOWN) return WEBKIT_GLOBAL_PROBE_OK;
  const hti = window.htmlToImage;
  if (!hti?.toPng) {
    if (IS_WEBKIT_LIKE) { WEBKIT_GLOBAL_PROBE_KNOWN = true; WEBKIT_GLOBAL_PROBE_OK = false; }
    return false;
  }
  const target = getCurrentFrame(container);
  if (!target) {
    if (IS_WEBKIT_LIKE) { WEBKIT_GLOBAL_PROBE_KNOWN = true; WEBKIT_GLOBAL_PROBE_OK = false; }
    return false;
  }
  // 对 iframe：检查同源 + 非空内容
  try {
    const frame = container.querySelector('iframe');
    if (frame) {
      // 如果 iframe src 是 blob/data/about:blank 或跨域，html-to-image foreignObject 一定拿不到内部内容
      const src = frame.getAttribute('src') || '';
      if (/^blob:|^data:|^about:/.test(src)) {
        // EPUB reader 用 blob: URL 加载 iframe → foreignObject 序列化不进 iframe 内容
        if (IS_WEBKIT_LIKE) { WEBKIT_GLOBAL_PROBE_KNOWN = true; WEBKIT_GLOBAL_PROBE_OK = false; }
        return false;
      }
    }
  } catch (_) { /* 忽略 */ }
  let timeoutId = 0;
  try {
    const result = await Promise.race([
      hti.toPng(target.el, {
        x: target.x, y: target.y, width: target.width, height: target.height,
        pixelRatio: 1, quality: 0.6, // 快速低质量探测
      }),
      new Promise((_, rej) => {
        timeoutId = window.setTimeout(() => rej(new Error('probe timeout')), PROBE_TIMEOUT_MS);
      }),
    ]);
    const ok = dataUrlIsInformative({ dataUrl: result, width: target.width, height: target.height });
    if (IS_WEBKIT_LIKE) { WEBKIT_GLOBAL_PROBE_KNOWN = true; WEBKIT_GLOBAL_PROBE_OK = ok; }
    return ok;
  } catch (_) {
    if (IS_WEBKIT_LIKE) { WEBKIT_GLOBAL_PROBE_KNOWN = true; WEBKIT_GLOBAL_PROBE_OK = false; }
    return false;
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }
}

function ensureProbe(container) {
  // 非 WebKit：跳过预检测 → 直接信任（Chrome 稳定）
  if (!IS_WEBKIT_LIKE) return Promise.resolve(true);
  // 已知全局结果：立即返回
  if (WEBKIT_GLOBAL_PROBE_KNOWN) return Promise.resolve(WEBKIT_GLOBAL_PROBE_OK);
  // 已有容器级的 probe Promise：复用同一个
  let p = probeCallbacks.get(container);
  if (p) return p;
  probeResults.set(container, 'testing');
  p = runProbe(container).then((ok) => {
    probeResults.set(container, ok ? 'ok' : 'fail');
    return ok;
  });
  probeCallbacks.set(container, p);
  return p;
}

// 给外部（EPUB 渲染完成后）主动触发一次 probe，避免用户第一次翻页才等 300ms
export async function warmupPageTurnCapture(container) {
  if (!IS_WEBKIT_LIKE || WEBKIT_GLOBAL_PROBE_KNOWN || !container) return;
  try { await runProbe(container); } catch (_) { /* 忽略 */ }
}

// ── 截图当前书页 ────────────────────────────────────────────────
// 找到容器内当前显示的 iframe，用 html-to-image 截取其实际渲染视口，
// 得到「当前真实书页」的图片。这是真实内容过渡的基础。
const frameProviders = new WeakMap();

// 注册「当前书页文档」提供者。由于 epub/mobi 渲染器内部结构不同
// （如 foliate 用 closed shadow root，DOM 查询拿不到 iframe），
// 各渲染器注册一个返回当前 contentDocument 的函数。
export function setPageFrameProvider(container, provider) {
  if (provider) frameProviders.set(container, provider);
  else frameProviders.delete(container);
}

function getCurrentFrame(container) {
  if (!container) return null;
  const provider = frameProviders.get(container);
  let provided = null;
  if (typeof provider === 'function') {
    provided = provider();
  } else {
    provided = container.querySelector('iframe')?.contentDocument ?? null;
  }
  const doc = provided?.document ?? (provided?.nodeType === 1 ? provided.ownerDocument : provided);
  if (!doc) return null;
  const viewport = provided?.viewport;
  const width = viewport?.clientWidth || doc.documentElement?.clientWidth || doc.body?.clientWidth;
  const height = viewport?.clientHeight || doc.documentElement?.clientHeight || doc.body?.clientHeight;
  if (!width || !height) return null;
  return {
    doc,
    width,
    height,
    x: Number(provided?.x) || 0,
    y: Number(provided?.y) || 0,
    el: provided?.el || doc.documentElement
  };
}

let captureQueue = Promise.resolve();

async function capturePage(container) {
  const target = getCurrentFrame(container);
  if (!target) return null;
  const hti = window.htmlToImage;
  if (!hti?.toPng) return null;
  const run = () => hti.toPng(target.el, {
    x: target.x,
    y: target.y,
    width: target.width,
    height: target.height,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    quality: 1,
  }).then((dataUrl) => ({ dataUrl, width: target.width, height: target.height }));
  const capture = captureQueue = captureQueue.then(run, run);
  let timeoutId;
  try {
    return await Promise.race([
      capture,
      new Promise((resolve) => {
        timeoutId = window.setTimeout(() => resolve(null), CAPTURE_TIMEOUT);
      })
    ]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

// ── DOM 工具 ────────────────────────────────────────────────────
function ensureSheet(container, direction) {
  let sheet = container.querySelector(':scope > .page-turn-sheet');
  if (!sheet) {
    sheet = document.createElement('div');
    sheet.className = 'page-turn-sheet';
    container.appendChild(sheet);
  }
  container.dataset.pageTurn = direction < 0 ? 'prev' : 'next';
  sheet.dataset.turnId = String((Number(sheet.dataset.turnId) || 0) + 1);
  sheet.dataset.direction = direction < 0 ? 'prev' : 'next';
  sheet.dataset.effect = currentEffect;
  return sheet;
}

function removeSheet(container, immediate, expectedSheet = null) {
  const sheet = container.querySelector(':scope > .page-turn-sheet');
  if (expectedSheet && sheet !== expectedSheet) return;
  if (sheet) {
    if (immediate) sheet.remove();
    else {
      sheet.classList.add('is-hidden');
      const turnId = sheet.dataset.turnId;
      window.setTimeout(() => {
        if (container.querySelector(':scope > .page-turn-sheet') === sheet
          && sheet.dataset.turnId === turnId) sheet.remove();
      }, 300);
    }
  }
  delete container.dataset.pageTurn;
  activeContainers.delete(container);
  dragStates.delete(container);
}

// 设置截图层：把 oldImg 作为真实旧页内容铺在 sheet 上（覆盖当前真实页）。
// 同时由隐藏态转为可见，避免在截图完成前暴露出空白纸片。
async function paintSheet(container, sheet, snap) {
  if (!snap) return;
  sheet.style.backgroundImage = `url(${snap.dataUrl})`;
  sheet.style.backgroundSize = 'cover';
  sheet.style.backgroundPosition = 'center';
  sheet.style.backgroundRepeat = 'no-repeat';
  sheet.style.setProperty('--page-w', `${snap.width}px`);
  sheet.style.setProperty('--page-h', `${snap.height}px`);
  sheet.classList.remove('is-pending');
  void sheet.offsetWidth; // reflow to flush background before revealing
}

// ── 失败计数 / bypass 工具 ────────────────────────────────────
function getStats(container) {
  let s = captureStats.get(container);
  if (!s) { s = { fails: 0, bypassUntil: 0 }; captureStats.set(container, s); }
  return s;
}
function recordCaptureFail(container) {
  const s = getStats(container);
  s.fails += 1;
  if (s.fails >= BYPASS_AFTER_FAILS) s.bypassUntil = Date.now() + BYPASS_WINDOW_MS;
}
function recordCaptureOk(container) {
  const s = captureStats.get(container);
  if (s) s.fails = 0;
}
// shouldBypassAnimation：同时考虑三类条件
//   1) WebKit 全局 probe 已知为 false → 永久 bypass（session 级）
//   2) probe 正在跑 → 暂时 bypass（避免第一页 300ms probe 期间翻页卡死）
//   3) 连续失败计数的短暂 bypass 窗口
function shouldBypassAnimation(container) {
  if (IS_WEBKIT_LIKE && WEBKIT_GLOBAL_PROBE_KNOWN && !WEBKIT_GLOBAL_PROBE_OK) return true;
  const probeState = probeResults.get(container);
  if (probeState === 'testing') return true;
  const s = captureStats.get(container);
  return Boolean(s && Date.now() < s.bypassUntil);
}

// 预先截图并铺上旧页图层（真实内容覆盖在当前真实页上）。
async function prepareTurn(container, sheet) {
  const snap = await capturePage(container);
  if (!snap) { recordCaptureFail(container); return false; }
  recordCaptureOk(container);
  // 截图前保持隐藏，避免空白纸片闪现
  sheet.classList.add('is-pending');
  await paintSheet(container, sheet, snap);
  const direction = sheet.dataset.direction === 'prev' ? -1 : 1;
  sheet.classList.remove('is-cancelled', 'is-hidden');
  applyEffectStart(sheet, direction);
  void sheet.offsetWidth; // force reflow
  return true;
}

// 执行导航并在新页渲染稳定后让旧页图层离场，揭示真实新页。
async function finalizeTurn(container, sheet, navigate) {
  if (typeof navigate === 'function') {
    try {
      await Promise.resolve(navigate());
    } catch (error) {
      console.warn('[page-turn] 页面导航失败:', error);
    }
  }
  window.setTimeout(() => {
    if (container.querySelector(':scope > .page-turn-sheet') !== sheet) return;
    sheet.classList.add('is-animating');
    applyEffectEnd(sheet);
    const turnId = sheet.dataset.turnId;
    const finish = () => {
      if (sheet.dataset.turnId !== turnId) return;
      removeSheet(container, false, sheet);
    };
    sheet.addEventListener('transitionend', finish, { once: true });
    window.setTimeout(finish, ANIMATION_DURATION + 80);
  }, SETTLE_DELAY);
}

// 让真实书页在动画开始时已就位：先 probe → 再截图当前页 → 铺 sheet → 执行导航。
// 关键性能：对 WebKit 先走 ensureProbe（一般 EPUB 都是 blob iframe，0~1ms 快速短路），
// 如果 probe 判为不可行，turnPage 会走到 activeContainers 之后再调用 runTurn → runTurn 顶部
// shouldBypassAnimation=true → 立即导航 + removeSheet。这里不再走 prepareTurn 的 300ms 等待。
async function runTurn(container, sheet, direction, navigate) {
  try {
    await ensureProbe(container);
    // 进入 bypass 模式：连续截图失败时不产生空 sheet、不阻塞主线程。
    if (shouldBypassAnimation(container)) {
      try { await Promise.resolve(navigate()); }
      catch (e) { console.warn('[page-turn] bypass 模式导航失败:', e); }
      finally { removeSheet(container, true, sheet); activeContainers.delete(container); }
      return;
    }
    const ok = await prepareTurn(container, sheet);
    if (!ok) {
      try {
        await Promise.resolve(navigate());
      } finally {
        removeSheet(container, true, sheet);
        activeContainers.delete(container);
      }
      return;
    }
    await finalizeTurn(container, sheet, navigate);
  } catch (error) {
    console.warn('[page-turn] 翻页动画失败，退回直接导航:', error);
    recordCaptureFail(container);
    removeSheet(container, true, sheet);
    try {
      await Promise.resolve(navigate());
    } catch (navigationError) {
      console.warn('[page-turn] 页面导航失败:', navigationError);
    }
  } finally {
    // 无论成功失败（含 bypass removeSheet 已删）都确保释放 activeContainers
    activeContainers.delete(container);
  }
}

// ── 效果状态控制 ────────────────────────────────────────────────
// 统一约定：sheet 上铺的是「旧页真实内容」，离场动画揭示下方真实新页。
const sign = (direction) => (direction < 0 ? 1 : -1);

// 离场起点（完全覆盖在真实新页上）
function applyEffectStart(sheet, direction) {
  const s = sign(direction);
  switch (sheet.dataset.effect || currentEffect) {
    case 'slide':
    case 'cover':
      sheet.style.setProperty('--turn-x', '0%');
      sheet.style.setProperty('--turn-opacity', '1');
      break;
    case 'fade':
      sheet.style.setProperty('--turn-opacity', '1');
      break;
    case 'flip':
      sheet.style.setProperty('--turn-angle', '0deg');
      sheet.style.setProperty('--turn-opacity', '1');
      break;
    case 'curl':
      sheet.style.setProperty('--curl-progress', '0');
      sheet.style.setProperty('--turn-opacity', '1');
      break;
  }
}

function applyEffectEnd(sheet) {
  const s = sign(sheet.dataset.direction === 'prev' ? -1 : 1);
  switch (sheet.dataset.effect || currentEffect) {
    case 'slide':
    case 'cover':
      sheet.style.setProperty('--turn-x', `${s * 100}%`);
      sheet.style.setProperty('--turn-opacity', '1');
      break;
    case 'fade':
      sheet.style.setProperty('--turn-opacity', '0');
      break;
    case 'flip':
      sheet.style.setProperty('--turn-angle', `${s * 180}deg`);
      sheet.style.setProperty('--turn-opacity', '1');
      break;
    case 'curl':
      sheet.style.setProperty('--curl-progress', '1');
      sheet.style.setProperty('--turn-opacity', '1');
      break;
  }
}

function applyEffectCancel(sheet, direction) {
  const s = sign(direction);
  switch (sheet.dataset.effect || currentEffect) {
    case 'slide':
    case 'cover':
      sheet.style.setProperty('--turn-x', '0%');
      sheet.style.setProperty('--turn-opacity', '1');
      break;
    case 'fade':
      sheet.style.setProperty('--turn-opacity', '1');
      break;
    case 'flip':
      sheet.style.setProperty('--turn-width', '100%');
      sheet.style.setProperty('--turn-angle', '0deg');
      sheet.style.setProperty('--turn-opacity', '1');
      break;
    case 'curl':
      sheet.style.setProperty('--curl-progress', '0');
      sheet.style.setProperty('--turn-opacity', '1');
      break;
  }
}

// ── 拖拽状态 ────────────────────────────────────────────────────
// 拖动时 sheet 铺的是「当前真实页」，随手指移动；松手翻页后离场揭示真实新页。
async function startDrag(container, sheet, direction) {
  // 如果已进入 bypass 模式：直接移除 sheet，不要产生一层透明盖挡住后续点击/按键
  if (shouldBypassAnimation(container)) {
    dragStates.delete(container);
    removeSheet(container, true, sheet);
    return;
  }
  const snap = await capturePage(container);
  if (!snap) {
    // 截图失败：清掉 drag 状态 + 立即移除 sheet，避免空层留在上面卡住交互
    recordCaptureFail(container);
    dragStates.delete(container);
    removeSheet(container, true, sheet);
    return;
  }
  recordCaptureOk(container);
  if (dragStates.get(container)?.sheet === sheet) await paintSheet(container, sheet, snap);
}

function updateDrag(sheet, direction, progress) {
  const s = sign(direction);
  const p = Math.max(0, Math.min(1, progress));
  switch (sheet.dataset.effect || currentEffect) {
    case 'slide':
    case 'cover':
      // 旧页随手指滑向该方向，露出下方真实新页
      sheet.style.setProperty('--turn-x', `${s * p * 100}%`);
      sheet.style.setProperty('--turn-opacity', '1');
      break;
    case 'fade':
      sheet.style.setProperty('--turn-opacity', String(1 - p));
      break;
    case 'flip':
      sheet.style.setProperty('--turn-angle', `${s * p * 180}deg`);
      sheet.style.setProperty('--turn-opacity', '1');
      break;
    case 'curl':
      sheet.style.setProperty('--curl-progress', String(p));
      sheet.style.setProperty('--turn-opacity', '1');
      break;
  }
}

// ── 公开 API ────────────────────────────────────────────────────

export function turnPage(container, direction, navigate) {
  if (!container || typeof navigate !== 'function' || activeContainers.has(container)) return false;
  // bypass 模式：完全跳过 sheet / 截图，直接导航，避免空层 + 失败重试开销
  if (shouldBypassAnimation(container)) {
    void Promise.resolve(navigate()).catch(e => console.warn('[page-turn] bypass 导航失败:', e));
    return true;
  }
  activeContainers.add(container);
  const sheet = ensureSheet(container, direction);
  sheet.classList.remove('is-animating', 'is-cancelled', 'is-hidden');
  sheet.classList.add('is-pending');
  applyEffectStart(sheet, direction);
  void runTurn(container, sheet, direction, navigate);
  return true;
}

export function beginPageDrag(container, direction, width) {
  if (!container || activeContainers.has(container) || width <= 0) return false;
  if (shouldBypassAnimation(container)) return false; // bypass：不生成 sheet，拖拽无动画
  const sheet = ensureSheet(container, direction);
  sheet.classList.remove('is-animating', 'is-cancelled', 'is-hidden');
  sheet.classList.add('is-pending');
  applyEffectStart(sheet, direction);
  dragStates.set(container, { direction, width, sheet });
  void startDrag(container, sheet, direction);
  return true;
}

export function updatePageDrag(container, distanceX) {
  const drag = dragStates.get(container);
  if (!drag) return;
  const progress = Math.max(0, Math.min(1, Math.abs(distanceX) / drag.width));
  updateDrag(drag.sheet, drag.direction, progress);
}

export function endPageDrag(container, distanceX, navigate, threshold = 0.2) {
  const drag = dragStates.get(container);
  if (!drag) return false;
  const progress = Math.max(0, Math.min(1, Math.abs(distanceX) / drag.width));
  const shouldTurn = progress >= threshold;
  dragStates.delete(container);

  if (!shouldTurn) {
    drag.sheet.classList.add('is-animating');
    applyEffectCancel(drag.sheet, drag.direction);
    window.setTimeout(() => removeSheet(container, false, drag.sheet), ANIMATION_DURATION + 30);
    return false;
  }

  activeContainers.add(container);
  drag.sheet.classList.remove('is-cancelled', 'is-hidden');
  // 先瞬移回完全覆盖，避免导航期间从拖拽缝隙露出未切换的旧页
  applyEffectStart(drag.sheet, drag.direction);
  drag.sheet.offsetWidth; // force reflow
  void finalizeTurn(container, drag.sheet, navigate);
  return true;
}

export function cancelPageDrag(container) {
  const drag = dragStates.get(container);
  if (!drag) return;
  drag.sheet.classList.add('is-animating');
  applyEffectCancel(drag.sheet, drag.direction);
  dragStates.delete(container);
  window.setTimeout(() => removeSheet(container, false, drag.sheet), ANIMATION_DURATION + 30);
}

export function isPageTurning(container) {
  return Boolean(container && (activeContainers.has(container) || dragStates.has(container)));
}

/**
 * 同步判断：当前容器是否处于「跳过翻页动画，直接导航」模式。
 * 调用方（如 epubNext/epubPrev）可用它在最外层做短路，完全避开 turnPage 的
 * Promise + sheet 创建 + activeContainers 开销。
 *
 * 返回 true 的情况：
 *   1) WebKit 且 probe 尚未确认截图可行（默认 bypass，不等 probe 完成）
 *      — EPUB 用 blob iframe，WebKit 不可能截到内容，probe 只会确认失败
 *   2) 容器级 probe 正在跑（testing 期间不产生 sheet）
 *   3) 连续截图失败的短暂 bypass 窗口
 */
export function isPageTurnBypassed(container) {
  // WebKit 始终禁用截图翻页，避免 Safari 保留异步 transition/transform 状态。
  if (IS_WEBKIT_LIKE) return true;
  if (probeResults.get(container) === 'testing') return true;
  const s = captureStats.get(container);
  return Boolean(s && Date.now() < s.bypassUntil);
}

// ── bypass 模式导航锁（与 activeContainers 共用同一把锁）──────────
// Safari/EPUB blob iframe 场景下，bypass 路径不走 turnPage（不产生 sheet/动画），
// 但仍然需要一个「正在导航中」的互斥标记：
//   - 防止用户快速连按方向键把多个 rendition.next() 堆进队列
//   - 让 isPageTurning() 在 bypass 导航期间也返回 true，避免
//     pointer/touch handler 在翻页过程中又启动拖拽
// 复用 activeContainers，不额外引入新数据结构：turnPage() / runTurn()
// 已经用它来做动画期的互斥，bypass 导航期直接占位即可。
export function acquireNavLock(container) {
  if (!container || activeContainers.has(container)) return false;
  activeContainers.add(container);
  return true;
}
export function releaseNavLock(container) {
  if (container) activeContainers.delete(container);
}
