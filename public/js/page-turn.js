// ── 翻页动画引擎（真实内容过渡 + 5 种效果）────────────────────────
// 核心思路：翻页前后把「当前真实书页(iframe)」截图成图层，
// 用「旧页图层离场」的方式揭示动画期间已经真实切换好的新页。
// 这样手指/动画所见的都是真实书页内容，而非空白纸片。
//
// slide: 平滑滑动 (Kindle/微信读书风格)
// fade:  淡入淡出 (安静优雅)
// flip:  仿真翻页 (Apple Books 风格 3D 翻折)
// cover: 覆盖滑动 (iOS 风格)
// curl:  卷页揭页 (Google Play Books 风格)

const ANIMATION_DURATION = 460;
const SETTLE_DELAY = 40;      // 导航完成后等待渲染稳定的时间
const CAPTURE_TIMEOUT = 1200;
const EFFECTS = ['slide', 'fade', 'cover', 'curl'];
const STORAGE_KEY = 'reader-page-turn-effect';
const DEFAULT_EFFECT = 'slide';

let currentEffect = loadEffect();

const activeContainers = new WeakSet();
const dragStates = new WeakMap();

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

// 预先截图并铺上旧页图层（真实内容覆盖在当前真实页上）。
async function prepareTurn(container, sheet) {
  const snap = await capturePage(container);
  if (!snap) return false;
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

// 让真实书页在动画开始时已就位：先截图当前页，铺上 sheet，再执行导航。
async function runTurn(container, sheet, direction, navigate) {
  try {
    const ok = await prepareTurn(container, sheet);
    if (!ok) {
      // 无法截图（例如还未初始化完成）：退回直接导航，不遮挡。
      try {
        await Promise.resolve(navigate());
      } finally {
        removeSheet(container, true, sheet);
      }
      return;
    }
    await finalizeTurn(container, sheet, navigate);
  } catch (error) {
    // Safari 截图或过渡失败时必须释放 activeContainers，否则阅读器会永久拒绝翻页。
    console.warn('[page-turn] 翻页动画失败，退回直接导航:', error);
    removeSheet(container, true, sheet);
    try {
      await Promise.resolve(navigate());
    } catch (navigationError) {
      console.warn('[page-turn] 页面导航失败:', navigationError);
    }
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
  const snap = await capturePage(container);
  if (snap && dragStates.get(container)?.sheet === sheet) await paintSheet(container, sheet, snap);
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
