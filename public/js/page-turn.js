// ── 翻页动画引擎（支持 5 种效果）──────────────────────────────────
// slide: 平滑滑动 (Kindle/微信读书风格)
// fade:  淡入淡出 (安静优雅)
// flip:  仿真翻页 (Apple Books 风格 3D 翻折)
// cover: 覆盖滑动 (iOS 风格)
// curl:  卷页揭页 (Google Play Books 风格)

const ANIMATION_DURATION = 420;
const COVER_DELAY = 90;
const EFFECTS = ['slide', 'fade', 'flip', 'cover', 'curl'];
const STORAGE_KEY = 'reader-page-turn-effect';
const DEFAULT_EFFECT = 'flip';

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

// ── DOM 工具 ────────────────────────────────────────────────────
function ensureSheet(container, direction) {
  let sheet = container.querySelector(':scope > .page-turn-sheet');
  if (!sheet) {
    sheet = document.createElement('div');
    sheet.className = 'page-turn-sheet';
    container.appendChild(sheet);
  }
  const effect = currentEffect;
  container.dataset.pageTurn = direction < 0 ? 'prev' : 'next';
  sheet.dataset.direction = direction < 0 ? 'prev' : 'next';
  sheet.dataset.effect = effect;
  return sheet;
}

function removeSheet(container) {
  container.querySelector(':scope > .page-turn-sheet')?.remove();
  delete container.dataset.pageTurn;
  activeContainers.delete(container);
  dragStates.delete(container);
}

function revealAfterNavigation(container, sheet, navigation) {
  Promise.resolve(navigation).catch((error) => {
    console.warn('[page-turn] 页面导航失败:', error);
  });
  window.setTimeout(() => {
    window.requestAnimationFrame(() => {
      sheet.classList.add('is-animating');
      applyEffectEnd(sheet);
      window.setTimeout(() => removeSheet(container), ANIMATION_DURATION);
    });
  }, COVER_DELAY);
}

// ── 效果：初始态 / 拖拽态 / 结束态 ─────────────────────────────
// 每个效果通过 CSS 自定义属性驱动，JS 只负责设值。

// 程序化翻页的起始态：覆盖层已就位，准备导航后落下
function applyEffectCovered(sheet, direction, _containerWidth) {
  const sign = direction < 0 ? 1 : -1;
  switch (currentEffect) {
    case 'slide':
    case 'cover':
      sheet.style.setProperty('--turn-x', `${sign * 100}%`);
      sheet.style.setProperty('--turn-opacity', '1');
      break;
    case 'fade':
      sheet.style.setProperty('--turn-opacity', '0');
      break;
    case 'flip':
      sheet.style.setProperty('--turn-angle', `${sign * -18}deg`);
      sheet.style.setProperty('--turn-width', '100%');
      break;
    case 'curl':
      sheet.style.setProperty('--curl-progress', '0');
      sheet.style.setProperty('--turn-opacity', '1');
      break;
  }
}

// 拖拽起始态：新页面完全在被推开的位置，随手指进入
function applyEffectDragStart(sheet, direction, _containerWidth) {
  const sign = direction < 0 ? 1 : -1;
  switch (currentEffect) {
    case 'slide':
    case 'cover':
      sheet.style.setProperty('--turn-x', `${sign * 100}%`);
      break;
    case 'fade':
      sheet.style.setProperty('--turn-opacity', '0');
      break;
    case 'flip':
      sheet.style.setProperty('--turn-angle', `${sign * -18}deg`);
      sheet.style.setProperty('--turn-width', '0%');
      break;
    case 'curl':
      sheet.style.setProperty('--curl-progress', '0');
      break;
  }
}

function applyEffectDrag(sheet, direction, progress, _containerWidth) {
  const sign = direction < 0 ? 1 : -1;
  const p = Math.max(0, Math.min(1, progress));
  switch (currentEffect) {
    case 'slide':
      sheet.style.setProperty('--turn-x', `${sign * (1 - p) * 100}%`);
      break;
    case 'fade':
      sheet.style.setProperty('--turn-opacity', String(p));
      break;
    case 'flip':
      sheet.style.setProperty('--turn-width', `${p * 100}%`);
      sheet.style.setProperty('--turn-angle', `${sign * (1 - p) * -18}deg`);
      break;
    case 'cover':
      sheet.style.setProperty('--turn-x', `${sign * (1 - p) * 100}%`);
      break;
    case 'curl':
      sheet.style.setProperty('--curl-progress', String(p));
      break;
  }
}

function applyEffectEnd(sheet) {
  switch (currentEffect) {
    case 'slide':
      sheet.style.setProperty('--turn-x', '0%');
      break;
    case 'fade':
      sheet.style.setProperty('--turn-opacity', '1');
      break;
    case 'flip':
      sheet.style.setProperty('--turn-angle', '0deg');
      sheet.style.setProperty('--turn-width', '100%');
      break;
    case 'cover':
      sheet.style.setProperty('--turn-x', '0%');
      break;
    case 'curl':
      sheet.style.setProperty('--curl-progress', '1');
      break;
  }
}

function applyEffectCancel(sheet, direction) {
  const sign = direction < 0 ? 1 : -1;
  switch (currentEffect) {
    case 'slide':
      sheet.style.setProperty('--turn-x', `${sign * 100}%`);
      break;
    case 'fade':
      sheet.style.setProperty('--turn-opacity', '0');
      break;
    case 'flip':
      sheet.style.setProperty('--turn-width', '0%');
      sheet.style.setProperty('--turn-angle', `${sign * -18}deg`);
      break;
    case 'cover':
      sheet.style.setProperty('--turn-x', `${sign * 100}%`);
      break;
    case 'curl':
      sheet.style.setProperty('--curl-progress', '0');
      break;
  }
}

// ── 公开 API ────────────────────────────────────────────────────

export function turnPage(container, direction, navigate) {
  if (!container || typeof navigate !== 'function' || activeContainers.has(container)) return false;

  activeContainers.add(container);
  const sheet = ensureSheet(container, direction);
  const w = container.getBoundingClientRect().width || window.innerWidth;
  sheet.classList.remove('is-animating', 'is-cancelled');
  applyEffectCovered(sheet, direction, w);
  sheet.offsetWidth; // force reflow

  try {
    revealAfterNavigation(container, sheet, navigate());
  } catch (error) {
    removeSheet(container);
    throw error;
  }
  return true;
}

export function beginPageDrag(container, direction, width) {
  if (!container || activeContainers.has(container) || width <= 0) return false;
  const sheet = ensureSheet(container, direction);
  sheet.classList.remove('is-animating', 'is-cancelled');
  applyEffectDragStart(sheet, direction, width);
  sheet.style.setProperty('--turn-opacity', currentEffect === 'fade' ? '0' : '1');
  dragStates.set(container, { direction, width, sheet });
  return true;
}

export function updatePageDrag(container, distanceX) {
  const drag = dragStates.get(container);
  if (!drag) return;
  const progress = Math.max(0, Math.min(1, Math.abs(distanceX) / drag.width));
  applyEffectDrag(drag.sheet, drag.direction, progress, drag.width);
}

export function endPageDrag(container, distanceX, navigate, threshold = 0.2) {
  const drag = dragStates.get(container);
  if (!drag) return false;
  const progress = Math.max(0, Math.min(1, Math.abs(distanceX) / drag.width));
  const shouldTurn = progress >= threshold;
  drag.sheet.classList.add('is-animating');
  if (shouldTurn) {
    applyEffectEnd(drag.sheet);
  } else {
    applyEffectCancel(drag.sheet, drag.direction);
  }
  dragStates.delete(container);

  if (!shouldTurn) {
    window.setTimeout(() => removeSheet(container), ANIMATION_DURATION);
    return false;
  }

  activeContainers.add(container);
  try {
    revealAfterNavigation(container, drag.sheet, navigate?.());
  } catch (error) {
    removeSheet(container);
    throw error;
  }
  return true;
}

export function cancelPageDrag(container) {
  if (!dragStates.has(container)) return;
  const { sheet, direction } = dragStates.get(container);
  sheet.classList.add('is-animating');
  applyEffectCancel(sheet, direction);
  dragStates.delete(container);
  window.setTimeout(() => removeSheet(container), ANIMATION_DURATION);
}

export function isPageTurning(container) {
  return Boolean(container && (activeContainers.has(container) || dragStates.has(container)));
}
