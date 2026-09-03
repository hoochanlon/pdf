// EPUB 导航交互模块 —— 仅负责：
//  1) iframe 内 + 宿主层的翻页事件（键盘 / 点击分区 / 指针 / 触控板横滑）
//  2) 翻页效果（page-turn）选择器 UI
//
// 不负责：样式注入、进度条、目录渲染、locations 缓存、整本书编排。
// 这些在各自模块里。
import { state } from './state.js';
import { $ } from './utils.js';
import { t, LANGUAGE_CHANGE_EVENT } from './i18n.js';
import {
  beginPageDrag, cancelPageDrag, endPageDrag,
  getPageTurnEffect, getAvailableEffects, isPageTurning,
  setPageTurnEffect, turnPage, updatePageDrag,
} from './page-turn.js';
import { toggleTOC, epubNext, epubPrev } from './epub.js?v=16';

// ── 翻页节流（键盘/点击/滑动共用，保证同一次输入窗口不会重复翻页）──────
// 420ms 阈值：给 rendition.next() 足够时间完成，避免 Safari 慢列重算期间又来第二个请求。
// 之前 320ms 在一次触控板动量手势（~600ms 持续期）内可能过 2 次，现 420 只能过 1 次。
let lastEPUBNavAt = 0;
const NAV_THROTTLE_MS = 420;
// 最近一次 wheel 导致的 requestEPUBNav 时间戳 —— 用来给宿主层/iframe 层的双层
// wheel 监听器做去重（WebKit 下两层都挂了）。
let lastWheelNavAt = 0;
const WHEEL_DOUBLE_SCAN_WINDOW = 80; // 80ms 内两次 requestEPUBNav 且来源都是 wheel 算重复
export function requestEPUBNav(direction, meta = {}) {
  const now = Date.now();
  if (now - lastEPUBNavAt < NAV_THROTTLE_MS) return;
  // 如果这次是 wheel 触发的，且 80ms 内已经有一次 wheel 触发了导航（很可能是双层监听重复），跳过
  if (meta.isWheel && now - lastWheelNavAt < WHEEL_DOUBLE_SCAN_WINDOW) return;
  lastEPUBNavAt = now;
  if (meta.isWheel) lastWheelNavAt = now;
  void (direction < 0 ? epubPrev() : epubNext());
}

// ── 翻页效果选择器 UI ──────────────────────────────────────────────
const EFFECT_LABELS = {
  slide: () => t('reader.pageTurnSlide'),
  fade:  () => t('reader.pageTurnFade'),
  flip:  () => t('reader.pageTurnFlip'),
  cover: () => t('reader.pageTurnCover'),
  curl:  () => t('reader.pageTurnCurl'),
};

let epubTurnSelectorBound = false;

function getEffectIcon(effect) {
  switch (effect) {
    case 'slide': return '↔';
    case 'fade':  return '◐';
    case 'flip':  return '↻';
    case 'cover': return '⇥';
    case 'curl':  return '◗';
    default: return '•';
  }
}

function renderPageTurnDropdown(wrap) {
  const dropdown = wrap.querySelector('.page-turn-dropdown');
  if (!dropdown) return;
  const current = getPageTurnEffect();
  dropdown.replaceChildren();
  getAvailableEffects().forEach((effect) => {
    const btn = document.createElement('button');
    btn.className = 'page-turn-option';
    btn.type = 'button';
    btn.role = 'option';
    btn.dataset.effect = effect;
    btn.setAttribute('aria-selected', effect === current ? 'true' : 'false');
    btn.innerHTML = `<span class="page-turn-option-icon">${getEffectIcon(effect)}</span><span>${EFFECT_LABELS[effect]()}</span><span class="page-turn-option-check">✓</span>`;
    btn.addEventListener('click', () => {
      setPageTurnEffect(effect);
      dropdown.querySelectorAll('.page-turn-option').forEach((opt) => {
        opt.setAttribute('aria-selected', opt.dataset.effect === effect ? 'true' : 'false');
      });
      wrap.querySelector('.reader-btn').setAttribute('aria-expanded', 'false');
      dropdown.hidden = true;
    });
    dropdown.appendChild(btn);
  });
}

export function setupPageTurnSelector() {
  const wrap = $('#epub-turn-selector');
  if (!wrap) return;
  const trigger = wrap.querySelector('.reader-btn');
  const dropdown = wrap.querySelector('.page-turn-dropdown');
  if (!trigger || !dropdown) return;

  renderPageTurnDropdown(wrap);

  if (epubTurnSelectorBound) return; // 已绑定过，仅刷新语言
  epubTurnSelectorBound = true;

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    renderPageTurnDropdown(wrap);
    const open = !dropdown.hidden;
    dropdown.hidden = open;
    trigger.setAttribute('aria-expanded', String(!open));
  });

  document.addEventListener('click', (e) => {
    if (wrap.contains(e.target)) return;
    dropdown.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  });

  window.addEventListener(LANGUAGE_CHANGE_EVENT, () => renderPageTurnDropdown(wrap));
}

// ═══════════════════════════════════════════════════════════════════
// 翻页事件安装（豆瓣式交互）：iframe 内优先（Chrome） + 宿主层兜底（Safari/WebKit）
// ═══════════════════════════════════════════════════════════════════

// WebKit 内核检测：覆盖 Safari 桌面、iPadOS（含桌面模式）、iOS 上所有浏览器（CriOS/FxiOS/EdgiOS），
// 因为它们都强制走 WebKit，iframe 事件交付都不稳定。
function detectIsWebKitLike() {
  const ua = navigator.userAgent || '';
  const platform = (navigator.platform || '');
  const isIOSLike = /iPad|iPhone|iPod/i.test(platform)
    || (platform === 'MacIntel' && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1);
  const isDesktopSafari = /^((?!chrome|crios|android|edg|opr|fxios|fxiOS).)*safari/i.test(ua)
    || ((navigator.vendor || '').includes('Apple') && !/chrome|crios|edg|opr|fxios|fxiOS/i.test(ua));
  return isIOSLike || isDesktopSafari;
}

/**
 * 安装当前章节 iframe 的翻页交互。
 * 注意：每次新章节的 iframe 注入都会被 epub.js hooks.content 调一次，
 * 所以本函数的「全局监听器」有一次性绑定标记，「当前 iframe 级监听器」按 iframe.dataset 去重。
 *
 * @param {Document} frameDocument  iframe 内部 document
 * @param {HTMLIFrameElement|null} iframe  外层 iframe DOM 元素（宿主层兜底需要）
 * @param {Window|null} iframeWindow 显式传入的 iframe.contentWindow（可选兜底）
 */
export function installEPUBNavigation(frameDocument, iframe = null, iframeWindow = null) {
  const frameWindow = frameDocument?.defaultView || iframeWindow || (iframe?.contentWindow);
  if (!frameWindow) {
    console.warn('[EPUB Nav] 无法获取 iframe window，跳过交互安装');
    return;
  }
  const container = $('#epub-container');
  let gesture = null;
  let suppressClickUntil = 0;

  const isInteractiveTarget = (target) => target?.nodeType === 1
    && Boolean(target.closest('a, button, input, select, textarea'));
  const isHorizontalSwipe = (dx, dy) => (
    Math.abs(dx) >= 56 && Math.abs(dx) > Math.abs(dy) * 1.25
  );
  const closeTOCBeforeNavigation = () => {
    const sidebar = $('#epub-sidebar');
    if (!sidebar.classList.contains('show')) return false;
    toggleTOC(false);
    return true;
  };

  const isNavClick = (event) => state.epubMode === 'paginated'
    && !isInteractiveTarget(event.target)
    && Date.now() >= suppressClickUntil;

  function navigateByClickX(clientX, viewWidth) {
    if (closeTOCBeforeNavigation()) return;
    const width = viewWidth || frameWindow.innerWidth || iframe?.clientWidth || 0;
    if (!width) return;
    const edge = Math.min(width * 0.25, 140);
    if (clientX <= edge) requestEPUBNav(-1);
    else if (clientX >= width - edge) requestEPUBNav(1);
  }

  const navigateBySwipe = (dx, dy, event, target) => {
    if (!isHorizontalSwipe(dx, dy) || isInteractiveTarget(target)) return;
    if (closeTOCBeforeNavigation()) return;
    suppressClickUntil = Date.now() + 360;
    if (event.cancelable) event.preventDefault();
    // 物理书翻页习惯：从左往右拖 = 上一页，从右往左拖 = 下一页
    endPageDrag($('#epub-container'), dx, () => requestEPUBNav(dx < 0 ? -1 : 1), 0.15);
  };
  const suppressDraggedClick = (event) => {
    if (Date.now() >= suppressClickUntil) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClickUntil = 0;
  };

  try { frameDocument.addEventListener('contextmenu', (e) => e.preventDefault()); } catch (_) { /* 忽略 */ }

  // ── iframe 内键盘：document/window/body × capture+bubble 六路兜底 ──
  const handleFrameKeydown = (event) => {
    if (state.epubMode !== 'paginated' || event.target?.closest?.('input, textarea, select')) return;
    const navKeys = {
      ArrowLeft: -1, ArrowUp: -1, PageUp: -1,
      ArrowRight: 1, ArrowDown: 1, PageDown: 1, ' ': 1,
      w: -1, a: -1, s: 1, d: 1,
    };
    const codeKeys = { KeyW: -1, KeyA: -1, KeyS: 1, KeyD: 1 };
    const direction = navKeys[event.key]
      ?? navKeys[event.key?.toLowerCase?.()]
      ?? codeKeys[event.code];
    if (!direction) return;
    if (event.cancelable) event.preventDefault();
    requestEPUBNav(direction);
  };
  try {
    frameDocument.addEventListener('keydown', handleFrameKeydown, true);
    frameDocument.addEventListener('keydown', handleFrameKeydown, false);
    frameWindow.addEventListener('keydown', handleFrameKeydown, true);
    frameWindow.addEventListener('keydown', handleFrameKeydown, false);
    if (frameDocument.body) {
      if (!frameDocument.body.hasAttribute('tabindex')) {
        frameDocument.body.setAttribute('tabindex', '-1');
      }
      frameDocument.body.addEventListener('keydown', handleFrameKeydown, true);
      frameDocument.body.focus?.();
    }
  } catch (_) { /* 跨域 / 初始化未完成的 Safari 可能抛错，静默即可 */ }

  const isWebKitLike = detectIsWebKitLike();

  // ── iframe 内 Pointer Events：所有 pointerType 都接受（不只是 mouse）────
  if ('PointerEvent' in frameWindow) {
    let lastPointerEventAt = 0;
    const reset = () => { gesture = null; };
    frameDocument.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse') lastPointerEventAt = Date.now();
      const mouseInvalid = event.pointerType === 'mouse' && event.button !== 0;
      if (state.epubMode !== 'paginated' || event.isPrimary === false
        || mouseInvalid || isInteractiveTarget(event.target)) return;
      gesture = {
        id: event.pointerId,
        pointerType: event.pointerType,
        x: event.clientX,
        y: event.clientY,
        target: event.target,
        dragged: false,
      };
    }, { passive: true });
    frameDocument.addEventListener('pointermove', (event) => {
      if (!gesture || event.pointerId !== gesture.id) return;
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (isHorizontalSwipe(dx, dy)) {
        gesture.dragged = true;
        if (!isPageTurning($('#epub-container'))) beginPageDrag(
          $('#epub-container'), dx < 0 ? 1 : -1,
          frameWindow.innerWidth || iframe?.clientWidth || 1,
        );
        updatePageDrag($('#epub-container'), dx);
        if (event.cancelable) event.preventDefault();
      } else if (gesture.pointerType === 'mouse' && event.cancelable) {
        event.preventDefault();
      }
    }, { passive: false });
    frameDocument.addEventListener('pointerup', (event) => {
      if (event.pointerType === 'mouse') lastPointerEventAt = Date.now();
      if (!gesture || event.pointerId !== gesture.id) return;
      const current = gesture;
      reset();
      const dx = event.clientX - current.x;
      const dy = event.clientY - current.y;
      if (isHorizontalSwipe(dx, dy)) {
        navigateBySwipe(dx, dy, event, current.target);
        return;
      }
      if (!current.dragged && isNavClick(event)) navigateByClickX(event.clientX);
    }, { passive: false });
    frameDocument.addEventListener('pointercancel', () => {
      lastPointerEventAt = Date.now();
      cancelPageDrag($('#epub-container'));
      reset();
    }, { passive: true });

    // 传统鼠标兜底：只有最近 500ms 没收到 pointer 才生效（避免双触发）
    let mouseStart = null;
    frameDocument.addEventListener('mousedown', (event) => {
      if (Date.now() - lastPointerEventAt < 500 || event.button !== 0
        || state.epubMode !== 'paginated' || isInteractiveTarget(event.target)) return;
      mouseStart = { x: event.clientX, y: event.clientY, target: event.target };
    });
    frameDocument.addEventListener('mouseup', (event) => {
      if (!mouseStart || Date.now() - lastPointerEventAt < 500) return;
      const start = mouseStart;
      mouseStart = null;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (isHorizontalSwipe(dx, dy)) {
        navigateBySwipe(dx, dy, event, start.target);
      } else if (isNavClick(event)) {
        navigateByClickX(event.clientX);
      }
    });

    // Touch Events 兜底（若 Pointer 已处理会被 suppressClickUntil / gesture.dragged 拦住）
    let touchStart = null;
    frameDocument.addEventListener('touchstart', (event) => {
      if (state.epubMode !== 'paginated' || event.touches.length !== 1
        || isInteractiveTarget(event.target)) return;
      const touch = event.touches[0];
      touchStart = { x: touch.clientX, y: touch.clientY, target: event.target };
    }, { passive: true });
    frameDocument.addEventListener('touchend', (event) => {
      if (!touchStart || event.changedTouches.length !== 1) { touchStart = null; return; }
      const touch = event.changedTouches[0];
      const start = touchStart;
      touchStart = null;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (isHorizontalSwipe(dx, dy)) navigateBySwipe(dx, dy, event, start.target);
      else if (isNavClick(event)) navigateByClickX(touch.clientX);
    }, { passive: false });
    frameDocument.addEventListener('touchmove', (event) => {
      if (!touchStart || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const dx = touch.clientX - touchStart.x;
      const dy = touch.clientY - touchStart.y;
      if (!isHorizontalSwipe(dx, dy)) return;
      if (!isPageTurning($('#epub-container'))) beginPageDrag(
        $('#epub-container'), dx < 0 ? 1 : -1,
        frameWindow.innerWidth || iframe?.clientWidth || 1,
      );
      updatePageDrag($('#epub-container'), dx);
      if (event.cancelable) event.preventDefault();
    }, { passive: false });
    frameDocument.addEventListener('touchcancel', () => {
      cancelPageDrag($('#epub-container'));
      touchStart = null;
    }, { passive: true });
  } else {
    // 降级：旧版 WebKit 只有 Touch Events
    let touchStart = null;
    const resetTouch = () => { touchStart = null; };
    frameDocument.addEventListener('touchstart', (event) => {
      if (state.epubMode !== 'paginated' || event.touches.length !== 1
        || isInteractiveTarget(event.target)) return;
      const touch = event.touches[0];
      touchStart = { x: touch.clientX, y: touch.clientY, target: event.target };
    }, { passive: true });
    frameDocument.addEventListener('touchend', (event) => {
      if (!touchStart || event.changedTouches.length !== 1) { resetTouch(); return; }
      const touch = event.changedTouches[0];
      const current = touchStart;
      resetTouch();
      const dx = touch.clientX - current.x;
      const dy = touch.clientY - current.y;
      if (isHorizontalSwipe(dx, dy)) {
        navigateBySwipe(dx, dy, event, current.target);
        return;
      }
      if (isNavClick(event)) navigateByClickX(touch.clientX);
    }, { passive: false });
    frameDocument.addEventListener('touchmove', (event) => {
      if (!touchStart || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const dx = touch.clientX - touchStart.x;
      const dy = touch.clientY - touchStart.y;
      if (!isHorizontalSwipe(dx, dy)) return;
      if (!isPageTurning($('#epub-container'))) beginPageDrag(
        $('#epub-container'), dx < 0 ? 1 : -1,
        frameWindow.innerWidth || iframe?.clientWidth || 1,
      );
      updatePageDrag($('#epub-container'), dx);
      if (event.cancelable) event.preventDefault();
    }, { passive: false });
    frameDocument.addEventListener('touchcancel', () => {
      cancelPageDrag($('#epub-container'));
      resetTouch();
    }, { passive: true });
  }

  try {
    frameDocument.addEventListener('click', (event) => {
      if (!isInteractiveTarget(event.target)) toggleTOC(false);
    });
    frameDocument.addEventListener('click', suppressDraggedClick, true);
  } catch (_) { /* 忽略 */ }

  // ── iframe 内 wheel：触控板双指横滑 ──
  // 关键体验：一次连续横滑（含动量滚动期间）只翻一页，不要因为触控板的惯性（macOS 送 ~1.5s wheel 事件）
  // 就连翻 3~5 页。做法：
  //   阈值从 40 → 140（一次横滑手势的典型位移约 100~200px）
  //   wheelGestureLocked：翻页成功后立即上锁，400ms 内没新 wheel 事件 = 手势结束 → 解锁
  //   手势仍在（400ms 内又收到 wheel）→ 锁保持，不因为动量又翻第二页
  let wheelDeltaX = 0;
  let wheelGestureLocked = false;
  let wheelIdleTimer = null;
  let wheelLockTimer = null;
  const WHEEL_THRESHOLD = 140;
  const WHEEL_IDLE_UNLOCK_MS = 400; // 400ms 无新事件 → 认定手势结束
  const WHEEL_MIN_GAP_BETWEEN_GESTURES_MS = 700; // 两个独立翻页手势最少间隔 700ms
  function handleWheel(event) {
    if (state.epubMode !== 'paginated') return;
    if (closeTOCBeforeNavigation()) { wheelDeltaX = 0; return; }
    const { deltaX, deltaY } = event;
    if (Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return;
    clearTimeout(wheelIdleTimer);
    // idle timer 到期 = 手势真正结束 → 开锁 + 清累计
    wheelIdleTimer = window.setTimeout(() => {
      wheelGestureLocked = false;
      wheelDeltaX = 0;
      clearTimeout(wheelLockTimer);
      wheelLockTimer = null;
    }, WHEEL_IDLE_UNLOCK_MS);
    if (wheelGestureLocked) return; // 这个手势已经翻过页了，动量也不再累计判断
    wheelDeltaX += deltaX;
    if (Math.abs(wheelDeltaX) >= WHEEL_THRESHOLD) {
      if (event.cancelable) event.preventDefault();
      requestEPUBNav(wheelDeltaX > 0 ? 1 : -1, { isWheel: true });
      wheelGestureLocked = true;
      // 安全兜底：即便 idleTimer 永远重置（比如用户一直摇鼠标），700ms 后也强制解锁
      clearTimeout(wheelLockTimer);
      wheelLockTimer = window.setTimeout(() => {
        wheelGestureLocked = false;
        wheelDeltaX = 0;
      }, WHEEL_MIN_GAP_BETWEEN_GESTURES_MS);
      // 翻页后立刻把累计清零，避免解锁后剩余 delta 又触发一次
      wheelDeltaX = 0;
    }
  }
  try { frameDocument.addEventListener('wheel', handleWheel, { passive: false }); } catch (_) { /* 忽略 */ }

  // ══════════════════════════════════════════════════════════════════
  // 宿主层全局守卫（所有浏览器都做，但只在首次调用绑定一次）
  // ══════════════════════════════════════════════════════════════════
  if (!iframe || !container) return;
  if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1');

  const hostBindingKey = '__epubHostNavBound';
  if (!container[hostBindingKey]) container[hostBindingKey] = Object.create(null);
  const bound = container[hostBindingKey];

  function keepHostFocus() {
    try { iframe.blur(); } catch (_) { /* 忽略 */ }
    if (document.activeElement !== container) {
      try { container.focus({ preventScroll: true }); } catch (_) { /* 忽略 */ }
    }
  }
  if (!bound.focusPrimed) {
    bound.focusPrimed = true;
    window.setTimeout(keepHostFocus, 0);
    window.setTimeout(keepHostFocus, 250);
  }

  // 焦点守护：focusin 捕获（主）+ 2000ms 轮询（兜底）。
  // 不使用 120ms 暴力轮询，避免每帧 blur/focus 打断合成层动画。
  if (!bound.focusGuardsInstalled) {
    bound.focusGuardsInstalled = true;
    const onFocusIn = (event) => {
      if (state.renderMode !== 'epub' || state.epubMode !== 'paginated') return;
      const target = event.target;
      const currentFrame = container.querySelector('iframe');
      if (!currentFrame) return;
      if (target === currentFrame || (target && currentFrame.contains?.(target))) {
        keepHostFocus();
      }
    };
    document.addEventListener('focusin', onFocusIn, true);
    bound.focusinHandler = onFocusIn;

    bound.focusGuardTimer = window.setInterval(() => {
      if (!document.body.contains(container)) {
        window.clearInterval(bound.focusGuardTimer);
        return;
      }
      if (state.renderMode !== 'epub' || state.epubMode !== 'paginated') return;
      const currentFrame = container.querySelector('iframe');
      if (!currentFrame) return;
      const active = document.activeElement;
      if (active === currentFrame || (active && currentFrame.contains?.(active))) {
        keepHostFocus();
      }
    }, 2000);
  }

  // 宿主层捕获阶段 keydown：在 iframe 拿到事件之前先兜底（Safari 需要）
  if (!bound.captureKeydownInstalled) {
    bound.captureKeydownInstalled = true;
    const navKeys = {
      ArrowLeft: -1, ArrowUp: -1, PageUp: -1,
      ArrowRight: 1, ArrowDown: 1, PageDown: 1, ' ': 1,
      w: -1, a: -1, s: 1, d: 1,
    };
    const codeKeys = { KeyW: -1, KeyA: -1, KeyS: 1, KeyD: 1 };
    const onCaptureKeydown = (event) => {
      if (state.renderMode !== 'epub' || state.epubMode !== 'paginated') return;
      if (event.target?.closest?.('button, input, textarea, select')) return;
      const direction = navKeys[event.key]
        ?? navKeys[event.key?.toLowerCase?.()]
        ?? codeKeys[event.code];
      if (!direction) return;
      const ae = document.activeElement;
      const currentFrame = container.querySelector('iframe');
      const frameOwnsFocus = currentFrame && (ae === currentFrame
        || (ae && currentFrame.contains?.(ae))
        || (event.target && event.target.ownerDocument !== document));
      if (frameOwnsFocus) return;
      if (event.cancelable) event.preventDefault();
      requestEPUBNav(direction);
    };
    document.addEventListener('keydown', onCaptureKeydown, true);
    bound.captureKeydownHandler = onCaptureKeydown;
  }

  // 宿主层 wheel：挂在 container，命中 iframe 区域再触发（Safari iframe 内 wheel 可能不派发）
  // 与 iframe 内 wheel 使用同样的单手势单次锁 + 140 阈值；requestEPUBNav 的 WHEEL_DOUBLE_SCAN_WINDOW 80ms
  // 内去重再挡一层，保证同一次 wheel 事件风暴不会因双层监听器导致两次翻页。
  if (!bound.hostWheelInstalled) {
    bound.hostWheelInstalled = true;
    let hostDeltaX = 0;
    let hostGestureLocked = false;
    let hostIdleTimer = null;
    let hostLockTimer = null;
    const HOST_WHEEL_THRESHOLD = 140;
    const HOST_IDLE_UNLOCK_MS = 400;
    const HOST_MIN_GAP_MS = 700;
    // rect 缓存：container 尺寸不变时复用；touchmove 每帧不重取 getBoundingClientRect
    let hostFrameRectCache = null;
    let hostFrameRectAt = 0;
    const RECT_CACHE_MS = 600;
    function getFrameRect() {
      const now = Date.now();
      if (hostFrameRectCache && now - hostFrameRectAt < RECT_CACHE_MS) return hostFrameRectCache;
      const frame = container.querySelector('iframe');
      if (!frame) return null;
      hostFrameRectCache = frame.getBoundingClientRect();
      hostFrameRectAt = now;
      return hostFrameRectCache;
    }
    const onContainerWheel = (event) => {
      if (state.epubMode !== 'paginated') return;
      const { deltaX, deltaY } = event;
      if (Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return;
      const rect = getFrameRect();
      if (!rect) return;
      if (event.clientX < rect.left || event.clientX > rect.right
        || event.clientY < rect.top || event.clientY > rect.bottom) return;
      clearTimeout(hostIdleTimer);
      hostIdleTimer = window.setTimeout(() => {
        hostGestureLocked = false;
        hostDeltaX = 0;
        clearTimeout(hostLockTimer);
        hostLockTimer = null;
      }, HOST_IDLE_UNLOCK_MS);
      if (hostGestureLocked) return;
      hostDeltaX += deltaX;
      if (Math.abs(hostDeltaX) >= HOST_WHEEL_THRESHOLD) {
        if (event.cancelable) event.preventDefault();
        requestEPUBNav(hostDeltaX > 0 ? 1 : -1, { isWheel: true });
        hostGestureLocked = true;
        clearTimeout(hostLockTimer);
        hostLockTimer = window.setTimeout(() => {
          hostGestureLocked = false;
          hostDeltaX = 0;
        }, HOST_MIN_GAP_MS);
        hostDeltaX = 0;
      }
    };
    container.addEventListener('wheel', onContainerWheel, { passive: false });
    bound.hostWheelHandler = onContainerWheel;
  }

  // 非 WebKit：不挂外层 iframe 级监听器，避免与 iframe 内监听重复翻页
  if (!isWebKitLike) return;

  // ══════════════════════════════════════════════════════════════════
  // WebKit 专属：外层 iframe 元素兜底（pointer/mouse/touch）
  // hooks.content 每章都会调一次，故用 iframe.dataset 标记防同一 iframe 重复绑定。
  // ══════════════════════════════════════════════════════════════════
  if (iframe.dataset.webkitNavBound === '1') return;
  iframe.dataset.webkitNavBound = '1';

  // ── 性能优化：手势期间缓存 iframe.getBoundingClientRect() ──
  // getBoundingClientRect 会触发布局回读(reflow)，在 60fps 的 pointermove/touchmove 里
  // 每帧调用两次就是主因之一。改成：
  //   - 每次 *Start 取一次 rect，存在对应手势对象 rect 属性里
  //   - 一次手势期间，若容器没有 resize，rect.left/top 不变 → 复用缓存
  //   - resize 时用 ResizeObserver 在下一个 start 前重新获取（这里直接取到 rect 后缓存 1 帧，
  //     实际 Safari 的触摸滑动期间视口不会动，足以 100% 命中缓存）
  const hostWidth = () => iframe.clientWidth || frameWindow.innerWidth || container.clientWidth || 1;
  let cachedRect = null;
  function takeRect() {
    cachedRect = iframe.getBoundingClientRect();
    return cachedRect;
  }
  function localXFromEvent(event) {
    const rect = cachedRect || takeRect();
    return event.clientX - rect.left;
  }
  function localYFromEvent(event) {
    const rect = cachedRect || takeRect();
    return event.clientY - rect.top;
  }
  function clearCachedRectLater() {
    // 手势结束后延迟清空缓存，避免立即下一次滑动/点击又重取
    cachedRect = null;
  }

  let hostPointer = null;
  const hostPointerDown = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    if (state.epubMode !== 'paginated' || isInteractiveTarget(event.target)) return;
    takeRect(); // 一次性取 rect，后续 pointermove 全复用
    hostPointer = {
      x: localXFromEvent(event), y: localYFromEvent(event),
      id: event.pointerId, target: event.target, dragged: false,
    };
    keepHostFocus();
  };
  const hostPointerMove = (event) => {
    if (!hostPointer || (event.pointerId !== undefined && event.pointerId !== hostPointer.id)) return;
    const dx = localXFromEvent(event) - hostPointer.x;
    const dy = localYFromEvent(event) - hostPointer.y;
    if (!isHorizontalSwipe(dx, dy)) return;
    hostPointer.dragged = true;
    if (!isPageTurning(container)) beginPageDrag(container, dx < 0 ? 1 : -1, hostWidth());
    updatePageDrag(container, dx);
    if (event.cancelable) event.preventDefault();
  };
  const hostPointerUp = (event) => {
    if (!hostPointer || (event.pointerId !== undefined && event.pointerId !== hostPointer.id)) return;
    const cur = hostPointer;
    hostPointer = null;
    const dx = localXFromEvent(event) - cur.x;
    const dy = localYFromEvent(event) - cur.y;
    window.setTimeout(clearCachedRectLater, 0);
    if (isHorizontalSwipe(dx, dy)) {
      endPageDrag(container, dx, () => requestEPUBNav(dx < 0 ? -1 : 1), 0.15);
      return;
    }
    if (!cur.dragged) navigateByClickX(localXFromEvent(event), hostWidth());
    keepHostFocus();
  };
  const hostPointerCancel = () => {
    hostPointer = null;
    cancelPageDrag(container);
    clearCachedRectLater();
  };
  let sawHostPointerDown = false;
  let lastHostPointerDownAt = 0;
  if ('PointerEvent' in window) {
    iframe.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse') lastHostPointerDownAt = Date.now();
      sawHostPointerDown = true;
      hostPointerDown(event);
    }, { passive: true });
    iframe.addEventListener('pointermove', hostPointerMove, { passive: false });
    iframe.addEventListener('pointerup', hostPointerUp, { passive: false });
    iframe.addEventListener('pointercancel', hostPointerCancel, { passive: true });
  }

  let hostMouse = null;
  iframe.addEventListener('mousedown', (event) => {
    if (event.button !== 0 || state.epubMode !== 'paginated' || isInteractiveTarget(event.target)) return;
    if (sawHostPointerDown && Date.now() - lastHostPointerDownAt < 500) return;
    takeRect();
    hostMouse = { x: localXFromEvent(event), y: localYFromEvent(event), target: event.target };
  });
  iframe.addEventListener('mouseup', (event) => {
    if (!hostMouse) return;
    if (sawHostPointerDown && Date.now() - lastHostPointerDownAt < 500) { hostMouse = null; clearCachedRectLater(); return; }
    const cur = hostMouse;
    hostMouse = null;
    const dx = localXFromEvent(event) - cur.x;
    const dy = localYFromEvent(event) - cur.y;
    clearCachedRectLater();
    if (isHorizontalSwipe(dx, dy)) {
      endPageDrag(container, dx, () => requestEPUBNav(dx < 0 ? -1 : 1), 0.15);
      return;
    }
    navigateByClickX(localXFromEvent(event), hostWidth());
    keepHostFocus();
  });

  let hostTouch = null;
  iframe.addEventListener('touchstart', (event) => {
    if (state.epubMode !== 'paginated' || event.touches.length !== 1) return;
    if (sawHostPointerDown && Date.now() - lastHostPointerDownAt < 500) return;
    if (isInteractiveTarget(event.target)) return;
    takeRect();
    const t = event.touches[0];
    hostTouch = { x: localXFromEvent(t), y: localYFromEvent(t), target: event.target };
  }, { passive: true });
  iframe.addEventListener('touchmove', (event) => {
    if (!hostTouch || event.touches.length !== 1) return;
    const t = event.touches[0];
    const dx = localXFromEvent(t) - hostTouch.x;
    const dy = localYFromEvent(t) - hostTouch.y;
    if (!isHorizontalSwipe(dx, dy)) return;
    if (!isPageTurning(container)) beginPageDrag(container, dx < 0 ? 1 : -1, hostWidth());
    updatePageDrag(container, dx);
    if (event.cancelable) event.preventDefault();
  }, { passive: false });
  iframe.addEventListener('touchend', (event) => {
    if (!hostTouch) { hostTouch = null; return; }
    if (event.changedTouches.length !== 1) { hostTouch = null; return; }
    const t = event.changedTouches[0];
    const cur = hostTouch;
    hostTouch = null;
    if (sawHostPointerDown && Date.now() - lastHostPointerDownAt < 500) { clearCachedRectLater(); return; }
    const dx = localXFromEvent(t) - cur.x;
    const dy = localYFromEvent(t) - cur.y;
    clearCachedRectLater();
    if (isHorizontalSwipe(dx, dy)) {
      endPageDrag(container, dx, () => requestEPUBNav(dx < 0 ? -1 : 1), 0.15);
      return;
    }
    navigateByClickX(localXFromEvent(t), hostWidth());
    keepHostFocus();
  }, { passive: false });
  iframe.addEventListener('touchcancel', () => {
    hostTouch = null;
    cancelPageDrag(container);
    clearCachedRectLater();
  }, { passive: true });
}
