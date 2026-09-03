const ANIMATION_DURATION = 420;
const activeContainers = new WeakSet();
const dragStates = new WeakMap();

function ensureSheet(container, direction) {
  let sheet = container.querySelector(':scope > .page-turn-sheet');
  if (!sheet) {
    sheet = document.createElement('div');
    sheet.className = 'page-turn-sheet';
    container.appendChild(sheet);
  }
  container.dataset.pageTurn = direction < 0 ? 'prev' : 'next';
  sheet.dataset.direction = direction < 0 ? 'prev' : 'next';
  return sheet;
}

function removeSheet(container) {
  container.querySelector(':scope > .page-turn-sheet')?.remove();
  delete container.dataset.pageTurn;
  activeContainers.delete(container);
  dragStates.delete(container);
}

export function turnPage(container, direction, navigate) {
  if (!container || typeof navigate !== 'function' || activeContainers.has(container)) return false;

  activeContainers.add(container);
  const sheet = ensureSheet(container, direction);
  sheet.style.setProperty('--turn-width', '0%');
  sheet.classList.add('is-animating');

  try {
    const result = navigate();
    Promise.resolve(result).catch((error) => {
      console.warn('[page-turn] 页面导航失败:', error);
      sheet.classList.add('is-cancelled');
    });
  } catch (error) {
    removeSheet(container);
    throw error;
  }

  window.setTimeout(() => removeSheet(container), ANIMATION_DURATION);
  return true;
}

export function beginPageDrag(container, direction, width) {
  if (!container || activeContainers.has(container) || width <= 0) return false;
  const sheet = ensureSheet(container, direction);
  sheet.classList.remove('is-animating', 'is-cancelled');
  sheet.style.setProperty('--turn-width', '0%');
  dragStates.set(container, { direction, width, sheet });
  return true;
}

export function updatePageDrag(container, distanceX) {
  const drag = dragStates.get(container);
  if (!drag) return;
  const progress = Math.max(0, Math.min(1, Math.abs(distanceX) / drag.width));
  drag.sheet.style.setProperty('--turn-width', `${(progress * 100).toFixed(1)}%`);
}

export function endPageDrag(container, distanceX, navigate, threshold = 0.2) {
  const drag = dragStates.get(container);
  if (!drag) return false;
  const progress = Math.max(0, Math.min(1, Math.abs(distanceX) / drag.width));
  const shouldTurn = progress >= threshold;
  drag.sheet.classList.add('is-animating');
  drag.sheet.style.setProperty('--turn-width', shouldTurn ? '100%' : '0%');
  dragStates.delete(container);

  if (!shouldTurn) {
    window.setTimeout(() => removeSheet(container), ANIMATION_DURATION);
    return false;
  }

  activeContainers.add(container);
  try {
    const result = navigate?.();
    Promise.resolve(result).catch((error) => console.warn('[page-turn] 页面导航失败:', error));
  } catch (error) {
    removeSheet(container);
    throw error;
  }
  window.setTimeout(() => removeSheet(container), ANIMATION_DURATION);
  return true;
}

export function cancelPageDrag(container) {
  if (!dragStates.has(container)) return;
  const sheet = dragStates.get(container).sheet;
  sheet.classList.add('is-animating');
  sheet.style.setProperty('--turn-width', '0%');
  dragStates.delete(container);
  window.setTimeout(() => removeSheet(container), ANIMATION_DURATION);
}

export function isPageTurning(container) {
  return Boolean(container && (activeContainers.has(container) || dragStates.has(container)));
}
