// EPUB 进度模块
// 职责：
//   1) 进度条 UI 展示（setEPUBProgress）
//   2) 进度条拖动交互（setupEPUBProgressBar）
//   3) rendition relocated 时，把「当前 CFI / spine index / 百分比」同步到 state + 本地存储
//
// 不直接依赖导航事件。renderEPUB 在 relocated 钩子 / locations 生成钩子调用本模块的函数。
import { state } from './state.js';
import { $ } from './utils.js';
import { updateBookProgress } from './reading.js';

export function cfiValue(cfi) {
  return typeof cfi === 'string' ? cfi : cfi?.toString?.() || '';
}

export function clearEPUBProgressTracking() {
  const container = $('#epub-container');
  if (state.epubScrollHandler) {
    container.removeEventListener('scroll', state.epubScrollHandler);
    state.epubScrollHandler = null;
  }
  if (state.epubScrollFrame) cancelAnimationFrame(state.epubScrollFrame);
  state.epubScrollFrame = 0;
}

// ── 百分比文本 & 进度条宽度 ─────────────────────────────────────
export function setEPUBProgress(progress) {
  const safeProgress = Math.max(0, Math.min(1, Number(progress) || 0));
  const percent = Math.round(safeProgress * 100);
  $('#epub-progress-bar').style.width = `${safeProgress * 100}%`;
  $('#epub-progress-percent').textContent = `${percent}%`;
  $('#epub-progress-wrap').setAttribute('aria-valuenow', String(percent));
  const valueDisplay = $('#epub-progress-value');
  if (valueDisplay) valueDisplay.textContent = `${percent}%`;
}

// ── 进度条拖动跳转：用 book.locations 的百分比 ↔ CFI 换算 ─────────
export function setupEPUBProgressBar() {
  const wrap = $('#epub-progress-wrap');
  const bar = $('#epub-progress-bar');
  if (!wrap || !bar) return;
  if (wrap.dataset.bound === 'true') return;
  wrap.dataset.bound = 'true';

  let isDragging = false;
  let dragPointerId = null;
  let dragFraction = 0;

  function getProgressFromPoint(clientX) {
    const rect = wrap.getBoundingClientRect();
    const x = clientX - rect.left;
    return Math.max(0, Math.min(1, x / rect.width));
  }

  async function handleProgressChange(fraction) {
    if (!state.rendition || !state.book?.locations) return;
    const location = state.book.locations.cfiFromPercentage(fraction);
    state.epubProgressOverride = fraction;
    try {
      await state.rendition.display(location);
    } catch (error) {
      console.warn('EPUB 进度定位失败:', error);
    } finally {
      const current = state.rendition?.currentLocation?.();
      const loc = current?.then ? await current : current;
      if (state.epubProgressOverride !== fraction) return;
      state.epubProgressOverride = null;
      const start = loc?.start;
      if (start) {
        const cfi = cfiValue(start.cfi);
        if (cfi) state.epubLocation = cfi;
        const safeProgress = Math.max(0, Math.min(1, fraction));
        setEPUBProgress(safeProgress);
        updateBookProgress(
          state.activeFile,
          safeProgress,
          cfi ? { kind: 'epub-cfi', value: cfi } : undefined,
        );
      }
    }
  }

  function previewProgress(clientX) {
    dragFraction = getProgressFromPoint(clientX);
    setEPUBProgress(dragFraction);
  }

  function onStart(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    isDragging = true;
    dragPointerId = event.pointerId;
    wrap.classList.add('dragging');
    wrap.setPointerCapture?.(event.pointerId);
    previewProgress(event.clientX);
    event.preventDefault();
  }
  function onMove(event) {
    if (!isDragging || event.pointerId !== dragPointerId) return;
    previewProgress(event.clientX);
    event.preventDefault();
  }
  function onEnd(event) {
    if (!isDragging) return;
    if (event && event.pointerId !== dragPointerId) return;
    if (event) previewProgress(event.clientX);
    isDragging = false;
    const pointerId = dragPointerId;
    dragPointerId = null;
    wrap.releasePointerCapture?.(pointerId);
    wrap.classList.remove('dragging');
    handleProgressChange(dragFraction);
  }

  wrap.addEventListener('pointerdown', onStart, { passive: false });
  wrap.addEventListener('pointermove', onMove, { passive: false });
  wrap.addEventListener('pointerup', onEnd, { passive: false });
  wrap.addEventListener('pointercancel', onEnd, { passive: false });
  wrap.addEventListener('keydown', (event) => {
    const current = Number($('#epub-progress-wrap').getAttribute('aria-valuenow') || 0) / 100;
    const step = event.shiftKey ? 0.01 : 0.001;
    let next = current;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next -= step;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next += step;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = 1;
    else return;
    event.preventDefault();
    setEPUBProgress(next);
    handleProgressChange(next);
  });
}

// 新的位置对象 → 更新 state / 进度条 / 阅读记录（供 relocated 钩子调用）
export function updateSavedEPUBProgress(location, progress) {
  if (!state.activeFile || typeof progress !== 'number') return;
  const end = location?.end;
  let endProgress = end?.percentage;
  if (typeof endProgress !== 'number' && state.epubLocationsReady && end?.cfi) {
    endProgress = state.book.locations.percentageFromCfi(cfiValue(end.cfi));
  }
  const reachedEnd = location?.atEnd === true || end?.atEnd === true || endProgress >= 1;
  const safeProgress = reachedEnd ? 1 : Math.max(0, Math.min(1, progress));
  const cfi = cfiValue(location?.start?.cfi);
  setEPUBProgress(safeProgress);
  updateBookProgress(
    state.activeFile,
    safeProgress,
    cfi ? { kind: 'epub-cfi', value: cfi } : undefined,
  );
}

// 通用：book + href → spine index（目录点击跳转时用）
export function getEPUBSpineIndex(book, href, fallback) {
  const hrefWithoutFragment = href?.split('#', 1)[0] || href;
  return book.spine.get(href)?.index
    ?? book.spine.get(hrefWithoutFragment)?.index
    ?? fallback;
}

// rendition relocated → 计算当前章节 / 进度 / 页码，写入 state + UI + 存储
export function updateEPUBLocation(location) {
  const start = location?.start;
  if (!start) return;
  const cfi = cfiValue(start.cfi);
  if (cfi) state.epubLocation = cfi;
  const startIndex = Number(start.index);
  if (Number.isInteger(startIndex)) {
    state.epubCurrentChapter = state.epubChapters.findIndex((ch) => ch.spineIndex === startIndex);
  }

  let progress = start.percentage;
  if (typeof progress !== 'number' && state.epubLocationsReady && cfi) {
    progress = state.book.locations.percentageFromCfi(cfi);
  }
  const reachedEnd = location.atEnd === true || location.end?.atEnd === true;
  if (typeof progress === 'number') {
    progress = reachedEnd ? 1 : Math.max(0, Math.min(1, progress));
    if (state.epubProgressOverride === null) {
      updateSavedEPUBProgress(location, progress);
    } else {
      setEPUBProgress(state.epubProgressOverride);
    }
  }

  if (state.epubLocationsReady && cfi) {
    const locationIndex = state.book.locations.locationFromCfi(cfi);
    state.epubCurrentPage = Math.max(1, Math.min(state.epubTotalPages, locationIndex + 1));
  }
  // setEPUBPage 保留写 state（不刷新 UI），后续扩展用
  if (typeof state.epubCurrentPage === 'number' && typeof state.epubTotalPages === 'number') {
    state.epubCurrentPage = state.epubCurrentPage || 0;
    state.epubTotalPages = state.epubTotalPages || 0;
  }
  // 章节按钮 UI 已移除，但保留函数避免外部调用报错
  if (typeof state.epubUpdateChapterControls === 'function') state.epubUpdateChapterControls();
}

// 兼容 epub.js 原文件末尾的函数签名（旧版导出 updateEPUBChapterControls 空壳，保留引用点）
export function updateEPUBChapterControls() { /* UI 已使用目录抽屉替代 */ }
