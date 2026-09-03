// MOBI 渲染模块 - 使用 foliate-js
import { state } from './state.js';
import { $ } from './utils.js';
import { updateBookProgress, markBookOpened, getBookReadingProgress } from './reading.js';
import { t } from './i18n.js';
import { getPageTurnEffect, getAvailableEffects, setPageTurnEffect } from './page-turn.js';
import { LANGUAGE_CHANGE_EVENT } from './i18n.js';

let mobiView = null;
let foliateLoaded = false;

// ── 翻页效果选择器 ────────────────────────────────────────────────
const EFFECT_LABELS = {
  slide: () => t('reader.pageTurnSlide'),
  fade: () => t('reader.pageTurnFade'),
  flip: () => t('reader.pageTurnFlip'),
  cover: () => t('reader.pageTurnCover'),
  curl: () => t('reader.pageTurnCurl')
};

let mobiTurnSelectorBound = false;

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

function setupPageTurnSelector() {
  const wrap = $('#mobi-turn-selector');
  if (!wrap) return;
  const trigger = wrap.querySelector('.reader-btn');
  const dropdown = wrap.querySelector('.page-turn-dropdown');
  if (!trigger || !dropdown) return;

  renderPageTurnDropdown(wrap);

  if (mobiTurnSelectorBound) {
    renderPageTurnDropdown(wrap); // 已绑定过，仅刷新语言
    return;
  }
  mobiTurnSelectorBound = true;

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    renderPageTurnDropdown(wrap); // 每次打开都刷新当前语言
    const open = !dropdown.hidden;
    dropdown.hidden = open;
    trigger.setAttribute('aria-expanded', String(!open));
  });

  document.addEventListener('click', (e) => {
    if (wrap.contains(e.target)) return;
    dropdown.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  });

  // 语言切换时即时刷新菜单文案
  window.addEventListener(LANGUAGE_CHANGE_EVENT, () => renderPageTurnDropdown(wrap));
}

function getEffectIcon(effect) {
  switch (effect) {
    case 'slide': return '↔';
    case 'fade': return '◐';
    case 'flip': return '↻';
    case 'cover': return '⇥';
    case 'curl': return '◗';
    default: return '•';
  }
}

async function loadFoliateJS() {
  if (foliateLoaded) return;

  try {
    console.log('[MOBI] 开始加载 foliate-js...');
    // 从本地路径加载 foliate-js（使用相对路径以兼容子路径部署）
    await import('../lib/foliate-js/view.js');
    foliateLoaded = true;
    console.log('[MOBI] foliate-js 加载成功');
  } catch (error) {
    console.error('[MOBI] foliate-js 加载失败:', error);
    throw new Error(t('reader.mobiLibraryLoadFailed', null, { message: error.message }));
  }
}

async function waitForLibrary(timeout = 10000) {
  const startedAt = Date.now();
  while (typeof customElements.get('foliate-view') === 'undefined') {
    if (Date.now() - startedAt >= timeout) {
      throw new Error(t('reader.mobiLibraryInitTimeout'));
    }
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  console.log('[MOBI] foliate-view 元素已注册');
}

function setMobiStatus(title, detail = '', isError = false) {
  const panel = $('#mobi-status');
  panel.classList.toggle('is-hidden', false);
  panel.classList.toggle('is-error', isError);
  $('#mobi-status-title').textContent = title;
  $('#mobi-status-detail').textContent = detail;
}

function hideMobiStatus() {
  $('#mobi-status').classList.add('is-hidden');
}

function setMobiProgress(progress) {
  const safeProgress = Math.max(0, Math.min(1, Number(progress) || 0));
  const percent = Math.round(safeProgress * 100);
  $('#mobi-progress-bar').style.width = `${safeProgress * 100}%`;
  $('#mobi-progress-percent').textContent = `${percent}%`;
  const valueDisplay = $('#mobi-progress-value');
  if (valueDisplay) valueDisplay.textContent = `${percent}%`;
  const progressWrap = $('#mobi-progress-wrap');
  if (progressWrap) {
    progressWrap.dataset.progress = String(safeProgress);
    progressWrap.setAttribute('aria-valuenow', String(percent));
  }
}

function setupMobiProgressBar() {
  const wrap = $('#mobi-progress-wrap');
  const bar = $('#mobi-progress-bar');
  if (!wrap || !bar || !mobiView) return;

  let isDragging = false;

  function getProgressFromEvent(event) {
    const rect = wrap.getBoundingClientRect();
    const x = (event.type.startsWith('touch') ? event.touches[0].clientX : event.clientX) - rect.left;
    return Math.max(0, Math.min(1, x / rect.width));
  }

  function handleProgressChange(fraction) {
    if (!mobiView) return;
    mobiView.goToFraction(fraction);
  }

  function onStart(event) {
    if (event.button !== undefined && event.button !== 0) return;
    isDragging = true;
    wrap.classList.add('dragging');
    wrap.focus({ preventScroll: true });
    const fraction = getProgressFromEvent(event);
    setMobiProgress(fraction);
    handleProgressChange(fraction);
    event.preventDefault();
  }

  function onMove(event) {
    if (!isDragging) return;
    const fraction = getProgressFromEvent(event);
    setMobiProgress(fraction);
    handleProgressChange(fraction);
    event.preventDefault();
  }

  function onEnd() {
    if (!isDragging) return;
    isDragging = false;
    wrap.classList.remove('dragging');
  }

  wrap.addEventListener('keydown', (event) => {
    const current = Number(wrap.dataset.progress || 0);
    const step = event.shiftKey ? 0.01 : 0.001;
    let next = current;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next -= step;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next += step;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = 1;
    else return;

    event.preventDefault();
    const fraction = Math.max(0, Math.min(1, next));
    setMobiProgress(fraction);
    void handleProgressChange(fraction);
  });

  wrap.addEventListener('mousedown', onStart);
  wrap.addEventListener('touchstart', onStart, { passive: false });
  document.addEventListener('mousemove', onMove);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('mouseup', onEnd);
  document.addEventListener('touchend', onEnd);
}

function setMobiPage(current, total) {
  // 保留函数避免其他地方的调用报错，但不再更新 UI
}

function buildMobiTOC(toc) {
  const tocList = $('#mobi-toc-list');
  tocList.replaceChildren();

  if (!toc || toc.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'pdf-outline-empty';
    empty.textContent = t('reader.mobiNoOutline');
    tocList.appendChild(empty);
    return;
  }

  const renderTocItem = (item, level = 0) => {
    const li = document.createElement('li');
    li.className = 'pdf-outline-item';

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = item.label || t('reader.untitledChapter');
    button.style.paddingLeft = `${12 + level * 14}px`;
    button.addEventListener('click', async (e) => {
      e.preventDefault();
      if (mobiView && item.href) {
        await mobiView.goTo(item.href);
        toggleMobiTOC(false);
      }
    });

    li.appendChild(button);
    tocList.appendChild(li);

    if (item.subitems) {
      item.subitems.forEach(subitem => renderTocItem(subitem, level + 1));
    }
  };

  toc.forEach(item => renderTocItem(item));
}

export function toggleMobiTOC(force) {
  const sidebar = $('#mobi-sidebar');
  const show = typeof force === 'boolean' ? force : !sidebar.classList.contains('show');
  sidebar.classList.toggle('show', show);
  sidebar.setAttribute('aria-hidden', String(!show));
  $('#mobi-toc').setAttribute('aria-expanded', String(show));
}

export function mobiNext() {
  if (mobiView) requestMobiNav(mobiView, 1);
}

export function mobiPrev() {
  if (mobiView) requestMobiNav(mobiView, -1);
}

function navigateMobi(view, direction) {
  return direction < 0 ? view.goLeft?.() : view.goRight?.();
}

let lastMobiNavAt = 0;

function requestMobiNav(view, direction) {
  const now = Date.now();
  if (now - lastMobiNavAt < 320) return false;
  lastMobiNavAt = now;
  return navigateMobi(view, direction);
}

// Wheel 事件监听器设置（独立函数，供 renderMOBI 调用）
function setupMobiWheelListener(view) {
  const container = $('#mobi-container');
  container._mobiWheelCleanup?.();
  const wheelState = container._mobiWheelState ?? {
    deltaX: 0,
    direction: 0,
    resetTimer: null,
    lastFlipAt: 0
  };
  container._mobiWheelState = wheelState;
  const WHEEL_THRESHOLD = 80; // 提高阈值到 80
  const MAX_WHEEL_STEP = 24;
  const FLIP_COOLDOWN = 650;

  const contents = view.renderer?.getContents?.();
  if (!contents || contents.length === 0) {
    console.warn('[MOBI] 无法获取 renderer contents');
    return null;
  }

  const iframeDoc = contents[0]?.doc;
  if (!iframeDoc) {
    console.warn('[MOBI] 无法获取 iframe document');
    return null;
  }

  console.log('[MOBI] 成功获取 iframe document，绑定 wheel 事件');

  const wheelHandler = (event) => {
    const now = performance.now();
    // 同一次触控板惯性会产生多个 wheel 事件，短时间内只允许一次翻页。
    if (now - wheelState.lastFlipAt < FLIP_COOLDOWN) {
      console.log('[MOBI] 翻页冷却中，忽略滑动');
      wheelState.deltaX = 0;
      wheelState.direction = 0;
      return;
    }

    const deltaX = event.deltaX;
    const deltaY = event.deltaY;

    // 更严格的横向判断：横向分量必须 > 垂直分量的 2 倍
    if (Math.abs(deltaX) <= Math.abs(deltaY) * 2.0) {
      wheelState.deltaX = 0;
      wheelState.direction = 0;
      return;
    }

    const direction = Math.sign(deltaX);
    if (wheelState.direction && wheelState.direction !== direction) {
      wheelState.deltaX = 0;
    }
    wheelState.direction = direction;
    const normalizedDeltaX = direction * Math.min(Math.abs(deltaX), MAX_WHEEL_STEP);

    // 清除重置定时器
    clearTimeout(wheelState.resetTimer);

    // 累积横向滚动距离
    wheelState.deltaX += normalizedDeltaX;

    console.log(`[MOBI] Wheel 累积: ${wheelState.deltaX.toFixed(1)}, 阈值: ${WHEEL_THRESHOLD}`);

    // 判断是否达到阈值
    if (Math.abs(wheelState.deltaX) >= WHEEL_THRESHOLD) {
      console.log(`[MOBI] Wheel ✓ 触发翻页！累积=${wheelState.deltaX.toFixed(1)}`);

      wheelState.lastFlipAt = now;

      // 正值（向左滑）：下一页，负值（向右滑）：上一页
      if (wheelState.deltaX > 0) {
        console.log('[MOBI] 向左滑动 -> 下一页');
        requestMobiNav(view, 1);
      } else {
        console.log('[MOBI] 向右滑动 -> 上一页');
        requestMobiNav(view, -1);
      }

      // 立即重置累积值
      wheelState.deltaX = 0;
      wheelState.direction = 0;

    } else {
      // 300ms 内没有新的 wheel 事件，重置累积值
      wheelState.resetTimer = setTimeout(() => {
        wheelState.deltaX = 0;
        wheelState.direction = 0;
      }, 300);
    }
  };

  iframeDoc.addEventListener('wheel', wheelHandler, { passive: true });

  // 返回清理函数
  const cleanup = () => {
    iframeDoc.removeEventListener('wheel', wheelHandler);
    clearTimeout(wheelState.resetTimer);
    if (container._mobiWheelCleanup === cleanup) delete container._mobiWheelCleanup;
  };
  container._mobiWheelCleanup = cleanup;
  return cleanup;
}

// 键盘翻页：iframe 内的 keydown 不冒泡到主文档，需在 iframe document 上单独接管。
function setupMobiKeyboardListener(view) {
  const contents = view.renderer?.getContents?.();
  if (!contents || contents.length === 0) {
    console.warn('[MOBI] 无法获取 renderer contents');
    return null;
  }
  const iframeDoc = contents[0]?.doc;
  if (!iframeDoc) {
    console.warn('[MOBI] 无法获取 iframe document');
    return null;
  }

  const keyHandler = (event) => {
    if (event.target?.closest?.('input, textarea, select')) return;
    const navKeys = {
      ArrowLeft: -1, ArrowUp: -1, PageUp: -1,
      ArrowRight: 1, ArrowDown: 1, PageDown: 1,
      w: -1, a: -1, s: 1, d: 1
    };
    const codeKeys = { KeyW: -1, KeyA: -1, KeyS: 1, KeyD: 1 };
    const direction = navKeys[event.key]
      ?? navKeys[event.key?.toLowerCase?.()]
      ?? codeKeys[event.code];
    if (!direction) return;
    event.preventDefault();
    requestMobiNav(view, direction);
  };

  const container = $('#mobi-container');
  container._mobiKeyboardCleanup?.();
  iframeDoc.addEventListener('keydown', keyHandler);
  const cleanup = () => {
    iframeDoc.removeEventListener('keydown', keyHandler);
    if (container._mobiKeyboardCleanup === cleanup) delete container._mobiKeyboardCleanup;
  };
  container._mobiKeyboardCleanup = cleanup;
  return cleanup;
}

function setupMobiDragListener(view) {
  const contents = view.renderer?.getContents?.();
  const iframeDocument = contents?.[0]?.doc;
  if (!iframeDocument) return null;
  const container = $('#mobi-container');
  container._mobiDragCleanup?.();
  let gesture = null;
  let lastPointerEventAt = 0;

  const onPointerDown = (event) => {
    lastPointerEventAt = Date.now();
    if (event.isPrimary === false
      || event.pointerType === 'mouse' && event.button !== 0
      || event.target?.closest?.('a, button, input, select, textarea')) return;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, target: event.target };
  };
  const onPointerMove = (event) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const distanceX = event.clientX - gesture.x;
    const distanceY = event.clientY - gesture.y;
    if (Math.abs(distanceX) < 24 || Math.abs(distanceX) <= Math.abs(distanceY) * 1.25) return;
    if (event.cancelable) event.preventDefault();
  };
  const onPointerUp = (event) => {
    lastPointerEventAt = Date.now();
    if (!gesture || event.pointerId !== gesture.id) return;
    const current = gesture;
    gesture = null;
    const distanceX = event.clientX - current.x;
    const distanceY = event.clientY - current.y;
    if (Math.abs(distanceX) > 56 && Math.abs(distanceX) > Math.abs(distanceY) * 1.25) {
      requestMobiNav(view, distanceX < 0 ? 1 : -1);
    }
  };
  const onPointerCancel = () => {
    gesture = null;
  };

  iframeDocument.addEventListener('pointerdown', onPointerDown, { passive: true });
  iframeDocument.addEventListener('pointermove', onPointerMove, { passive: false });
  iframeDocument.addEventListener('pointerup', onPointerUp, { passive: false });
  iframeDocument.addEventListener('pointercancel', onPointerCancel, { passive: true });

  // Safari 某些版本的 iframe 鼠标 Pointer Events 不稳定，保留传统鼠标事件兜底。
  let mouseStart = null;
  const onMouseDown = (event) => {
    if (Date.now() - lastPointerEventAt < 500 || event.button !== 0
      || event.target?.closest?.('a, button, input, select, textarea')) return;
    mouseStart = { x: event.clientX, y: event.clientY };
  };
  const onMouseUp = (event) => {
    if (!mouseStart || Date.now() - lastPointerEventAt < 500) return;
    const start = mouseStart;
    mouseStart = null;
    const distanceX = event.clientX - start.x;
    const distanceY = event.clientY - start.y;
    if (Math.abs(distanceX) > 56 && Math.abs(distanceX) > Math.abs(distanceY) * 1.25) {
      requestMobiNav(view, distanceX < 0 ? 1 : -1);
    }
  };
  iframeDocument.addEventListener('mousedown', onMouseDown);
  iframeDocument.addEventListener('mouseup', onMouseUp);
  const cleanup = () => {
    iframeDocument.removeEventListener('pointerdown', onPointerDown);
    iframeDocument.removeEventListener('pointermove', onPointerMove);
    iframeDocument.removeEventListener('pointerup', onPointerUp);
    iframeDocument.removeEventListener('pointercancel', onPointerCancel);
    iframeDocument.removeEventListener('mousedown', onMouseDown);
    iframeDocument.removeEventListener('mouseup', onMouseUp);
  };
  container._mobiDragCleanup = cleanup;
  return cleanup;
}

function setupMobiInteractions(view) {
  console.log('[MOBI] setupMobiInteractions 被调用，view=', view);

  if (!view) {
    console.error('[MOBI] setupMobiInteractions: view 对象为空！');
    return;
  }

  const container = $('#mobi-container');
  console.log('[MOBI] container=', container);

  // 移除旧的事件监听器
  const oldClickHandler = container._mobiClickHandler;
  const oldGestureHandler = container._mobiGestureHandler;
  if (oldClickHandler) container.removeEventListener('click', oldClickHandler);
  if (oldGestureHandler) {
    container.removeEventListener('touchstart', oldGestureHandler.touchStart, true);
    container.removeEventListener('touchend', oldGestureHandler.touchEnd, true);
    container.removeEventListener('pointerdown', oldGestureHandler.pointerDown, true);
    container.removeEventListener('pointerup', oldGestureHandler.pointerUp, true);
    container.removeEventListener('wheel', oldGestureHandler.wheelHandler, true);
    // 也从 view 上移除
    if (view) {
      view.removeEventListener('touchstart', oldGestureHandler.touchStart, true);
      view.removeEventListener('touchend', oldGestureHandler.touchEnd, true);
      view.removeEventListener('pointerdown', oldGestureHandler.pointerDown, true);
      view.removeEventListener('pointerup', oldGestureHandler.pointerUp, true);
      view.removeEventListener('wheel', oldGestureHandler.wheelHandler, true);
    }
    // 从 iframe documents 移除
    if (oldGestureHandler.iframeWheelCleanup) {
      oldGestureHandler.iframeWheelCleanup();
    }
  }

  // 点击翻页
  let lastTouchMoveAt = 0;
  const clickHandler = (e) => {
    if (Date.now() - lastTouchMoveAt < 500) return;
    // 忽略链接点击
    if (e.target.closest('a')) return;

    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;

    // 左边 1/3 区域：上一页
    if (x < width / 3) {
      requestMobiNav(view, -1);
    }
    // 右边 1/3 区域：下一页
    else if (x > width * 2 / 3) {
      requestMobiNav(view, 1);
    }
  };

  // Wheel 事件处理（在 iframe 的 document 上监听，关键！）
  const setupMobiWheelListener = (view) => {
    let wheelDeltaX = 0;
    let wheelResetTimer = null;
    const WHEEL_THRESHOLD = 80; // 触发翻页的累积滚动阈值

    const contents = view.renderer?.getContents?.();
    if (!contents || contents.length === 0) {
      console.warn('[MOBI] 无法获取 renderer contents');
      return null;
    }

    const iframeDoc = contents[0]?.doc;
    if (!iframeDoc) {
      console.warn('[MOBI] 无法获取 iframe document');
      return null;
    }

    console.log('[MOBI] 成功获取 iframe document，绑定 wheel 事件');

    const wheelHandler = (event) => {
      const deltaX = event.deltaX;
      const deltaY = event.deltaY;

      // 忽略主要为垂直滚动的情况
      if (Math.abs(deltaY) > Math.abs(deltaX)) {
        wheelDeltaX = 0;
        return;
      }

      // 清除重置定时器
      clearTimeout(wheelResetTimer);

      // 累积横向滚动距离
      wheelDeltaX += deltaX;

      console.log(`[MOBI] Wheel 累积: deltaX=${wheelDeltaX.toFixed(1)}, 本次=${deltaX.toFixed(1)}, deltaY=${deltaY.toFixed(1)}`);

      // 判断是否达到阈值
      if (Math.abs(wheelDeltaX) >= WHEEL_THRESHOLD) {
        console.log(`[MOBI] Wheel ✓ 触发翻页！累积=${wheelDeltaX.toFixed(1)}`);

        // 正值（向左滑）：下一页，负值（向右滑）：上一页
        if (wheelDeltaX > 0) {
          console.log('[MOBI] 向左滑动 -> 下一页');
          navigateMobi(view, 1);
        } else {
          console.log('[MOBI] 向右滑动 -> 上一页');
          navigateMobi(view, -1);
        }

        // 重置累积值
        wheelDeltaX = 0;
      }

      // 300ms 内没有新的 wheel 事件，重置累积值
      wheelResetTimer = setTimeout(() => {
        console.log('[MOBI] Wheel 超时重置');
        wheelDeltaX = 0;
      }, 300);
    };

    iframeDoc.addEventListener('wheel', wheelHandler, { passive: true });

    // 返回清理函数
    return () => {
      iframeDoc.removeEventListener('wheel', wheelHandler);
      clearTimeout(wheelResetTimer);
    };
  };

  // 尝试设置 iframe wheel 监听器
  // 注意：不在这里调用，而是在 renderMOBI 中通过 load 事件动态绑定

  const gestureHandlers = {
    clickHandler,
    iframeWheelCleanup: null  // 将在 renderMOBI 中管理
  };

  container._mobiClickHandler = clickHandler;
  container._mobiGestureHandler = gestureHandlers;

  container.addEventListener('click', clickHandler);
  container.addEventListener('touchmove', () => { lastTouchMoveAt = Date.now(); }, { passive: true });
  container.addEventListener('contextmenu', (event) => event.preventDefault());

  console.log('[MOBI] 已启用点击翻页和 iframe wheel 手势支持');
  console.log('[MOBI] 请尝试触控板滑动，查看控制台是否有 Wheel 事件日志');
}

// 页码跳转已废弃
function setupMobiPageJump() {
  // 保留函数避免调用报错
}

export async function renderMOBI(url, filename, requestId, restoreLocation = null) {
  console.log('[renderMOBI] 开始渲染:', filename);
  console.log('[renderMOBI] URL:', url);
  console.log('[renderMOBI] requestId:', requestId);
  if (requestId !== state.requestId) return;

  // 立即显示保存的进度（如果有）
  const savedProgress = getBookReadingProgress(filename);
  setMobiProgress(savedProgress);

  try {
    setMobiStatus(t('reader.loadingMobi'), t('reader.preparingLibrary'));

    // 先加载 foliate-js
    console.log('[MOBI] 步骤 1: 加载 foliate-js...');
    await loadFoliateJS();
    console.log('[MOBI] 步骤 1 完成: foliate-js 已加载');

    setMobiStatus(t('reader.loadingMobi'), t('reader.waitingLibraryInit'));

    // 等待 foliate-js 注册完成
    console.log('[MOBI] 步骤 2: 等待 foliate-view 注册...');
    await waitForLibrary();
    console.log('[MOBI] 步骤 2 完成: foliate-view 已注册');

    const container = $('#mobi-container');
    container.replaceChildren();

    setMobiStatus(t('reader.loadingMobi'), t('reader.creatingReader'));

    // 创建 foliate-view 元素
    console.log('[MOBI] 步骤 3: 创建 foliate-view 元素');
    const view = document.createElement('foliate-view');
    view.requestId = requestId;
    mobiView = view;
    container.appendChild(view);

    console.log('[MOBI] 步骤 3 完成: foliate-view 元素已创建并添加到 DOM');

    setMobiStatus(t('reader.parsingMobi'), t('reader.loadingFileContent'));

    console.log('[MOBI] 步骤 4: 调用 open() 方法...');
    console.log('[MOBI] 文件 URL:', url);

    // 打开 MOBI 文件
    await view.open(url);
    if (requestId !== state.requestId || mobiView !== view) return;
    console.log('[MOBI] 步骤 4 完成: open() 返回成功');

    // MOBI 使用 foliate 分页器自己的 viewport 动画，不使用截图覆盖层。
    view.renderer?.setAttribute('animated', '');

    // 按照 reader.js 的顺序，在 open() 之后添加事件监听器
    console.log('[MOBI] 步骤 5: 添加事件监听器');

    // 存储 iframe 监听器清理函数，用于每次 load 后重新绑定（iframe 会重建）
    let currentWheelCleanup = null;
    let currentKeyboardCleanup = null;
    let currentDragCleanup = null;
    let currentContentClickCleanup = null;

    view.addEventListener('load', (e) => {
      if (requestId !== state.requestId || mobiView !== view) return;
      console.log('[MOBI] ✓ load 事件触发:', e.detail);

      const contentDocument = e.detail?.doc;
      if (contentDocument) {
        currentContentClickCleanup?.();
        const closeTOCOnContentClick = () => {
          if ($('#mobi-sidebar').classList.contains('show')) toggleMobiTOC(false);
        };
        contentDocument.addEventListener('click', closeTOCOnContentClick);
        currentContentClickCleanup = () => {
          contentDocument.removeEventListener('click', closeTOCOnContentClick);
        };
        contentDocument.addEventListener('contextmenu', (event) => event.preventDefault());
        Object.assign(contentDocument.documentElement.style, {
          userSelect: 'none',
          webkitUserSelect: 'none',
          webkitTouchCallout: 'none',
          touchAction: 'none'
        });
        if (contentDocument.body) Object.assign(contentDocument.body.style, {
          userSelect: 'none',
          webkitUserSelect: 'none',
          webkitTouchCallout: 'none',
          touchAction: 'none'
        });
      }

      // 每次 load 后重新绑定监听器（因为 iframe 被重新创建）
      if (currentWheelCleanup) {
        currentWheelCleanup();
      }
      currentWheelCleanup = setupMobiWheelListener(view);
      if (currentKeyboardCleanup) {
        currentKeyboardCleanup();
      }
      currentKeyboardCleanup = setupMobiKeyboardListener(view);
      if (currentDragCleanup) {
        currentDragCleanup();
      }
      currentDragCleanup = setupMobiDragListener(view);
    });

    view.addEventListener('relocate', (e) => {
      if (requestId !== state.requestId || mobiView !== view) return;
      const detail = e.detail;
      console.log('[MOBI] relocate 事件:', detail);

      // 更新进度
      if (typeof detail.fraction === 'number') {
        setMobiProgress(detail.fraction);

        // 保存阅读进度
        const location = detail.cfi ? { kind: 'mobi-cfi', value: detail.cfi } : undefined;
        updateBookProgress(state.activeFile, detail.fraction, location);
      }
    });

    // 构建目录
    if (view.book?.toc) {
      console.log('[MOBI] 构建目录...');
      buildMobiTOC(view.book.toc);
    }

    // 关键步骤：导航到保存的位置或第一页
    console.log('[MOBI] 步骤 6: 调用 goTo() 开始渲染...');

    // 恢复到保存的位置或从头开始
    if (restoreLocation?.kind === 'mobi-cfi' && restoreLocation.value) {
      console.log('[MOBI] 恢复到保存的 CFI 位置:', restoreLocation.value);
      await view.goTo(restoreLocation.value);
    } else if (typeof savedProgress === 'number' && savedProgress > 0) {
      console.log('[MOBI] 恢复到进度:', Math.round(savedProgress * 100) + '%');
      await view.goToFraction(savedProgress);
    } else {
      console.log('[MOBI] 从第一页开始');
      await view.goTo(0);
    }

    if (requestId !== state.requestId || mobiView !== view) return;

    console.log('[MOBI] 步骤 6 完成: 已导航到目标位置');

    // 保存到全局状态，供键盘导航使用
    state.mobiView = mobiView;

    // 添加点击翻页支持
    setupMobiInteractions(mobiView);

    // 初始绑定 iframe 监听器
    if (!currentWheelCleanup) currentWheelCleanup = setupMobiWheelListener(view);
    if (!currentKeyboardCleanup) currentKeyboardCleanup = setupMobiKeyboardListener(view);
    if (!currentDragCleanup) currentDragCleanup = setupMobiDragListener(view);

    // 设置进度条交互
    setupMobiProgressBar();
    setupMobiPageJump();

    const metadata = state.booksMetadata?.[filename];
    let title;

    if (metadata?.title) {
      // 使用 books.json 中的自定义标题
      title = metadata.title;
    } else {
      // 回退到从文件名推断
      const basename = filename.split('/').pop();
      const nameWithoutExt = basename.replace(/\.(mobi|azw3?)$/i, '');
      title = nameWithoutExt.split('-')[0].trim();
    }

    $('#mobi-title').textContent = title;

    // 设置下载链接
    const dlLink = $('#mobi-download');
    if (dlLink) {
      dlLink.href = url;
      dlLink.download = filename.split('/').pop();
    }

    console.log('[MOBI] 步骤 7: 隐藏加载状态');
    hideMobiStatus();
    markBookOpened(filename);

    console.log('[renderMOBI] ✓ 渲染完成');

  } catch (error) {
    console.error('[renderMOBI] ✗ 渲染失败');
    console.error('[renderMOBI] 错误类型:', error.constructor.name);
    console.error('[renderMOBI] 错误消息:', error.message);
    console.error('[renderMOBI] 错误堆栈:', error.stack);
    setMobiStatus(t('reader.mobiLoadFailedTitle'), error.message || t('reader.cannotOpenFile'), true);
  }
}

export function destroyMOBI() {
  if (mobiView) {
    try {
      // foliate-view 可能没有 destroy 方法，直接移除即可
      mobiView.remove();
      mobiView = null;
      state.mobiView = null;
    } catch (error) {
      console.warn('[destroyMOBI] 清理失败:', error);
    }
  }
}

export function resetMobiState() {
  destroyMOBI();
  const container = $('#mobi-container');
  if (container) container.replaceChildren();
  $('#mobi-title').textContent = '—';
  hideMobiStatus();
  setMobiProgress(0);
  state.mobiView = null;
  const dlLink = $('#mobi-download');
  if (dlLink) { dlLink.removeAttribute('href'); dlLink.removeAttribute('download'); }
}
