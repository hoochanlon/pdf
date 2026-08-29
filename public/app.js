// 主入口文件
import { state } from './js/state.js';
import { $, fileUrl, isEpub, isMobile } from './js/utils.js';
import { renderMobilePDF } from './js/pdf.js';
import {
  renderEPUB,
  epubNext,
  epubPrev,
  epubChapterNext,
  epubChapterPrev,
  jumpToEPUBPage,
  setEPUBMode,
  resetEPUBState,
  toggleTOC
} from './js/epub.js';
import { initSidebar, closeSidebar } from './js/sidebar.js';
import { loadBookList } from './js/library.js';
import { markBookOpened } from './js/reading.js';

function clearReader() {
  state.requestId += 1;
  if (state.pdfObserver) state.pdfObserver.disconnect();
  if (state.pdfScrollHandler) {
    $('#pdf-canvas-container').removeEventListener('scroll', state.pdfScrollHandler);
    state.pdfScrollHandler = null;
  }
  if (state.pdfScrollFrame) cancelAnimationFrame(state.pdfScrollFrame);
  state.pdfScrollFrame = 0;
  state.pdfRenderTasks.forEach((task) => task.cancel());
  state.pdfRenderTasks.clear();
  if (state.pdfLoading) state.pdfLoading.destroy();
  if (state.pdf) state.pdf.destroy();
  if (state.rendition) state.rendition.destroy();
  if (state.book) state.book.destroy();
  state.epubResizeObservers.forEach((observer) => observer.disconnect());
  state.epubResizeObservers.clear();
  resetEPUBState();
  state.pdfObserver = null;
  state.pdfLoading = null;
  state.pdf = null;
  state.rendition = null;
  state.book = null;
  state.pdfUrl = null;
  state.pdfViewportWidth = 0;
  state.renderMode = null;
  $('#pdf-frame').src = '';
  $('#pdf-frame').classList.remove('show');
  $('#pdf-canvas-container').replaceChildren();
  $('#pdf-canvas-container').classList.remove('show');
  $('#epub-container').replaceChildren();
  $('#epub-reader').classList.remove('show');
  $('#epub-toc-panel').classList.remove('show');
}

function openBook(filename, item) {
  document.querySelectorAll('.book-item').forEach((element) => element.classList.remove('active'));
  item.classList.add('active');
  state.activeFile = filename;
  markBookOpened(filename);
  $('#empty-state').style.display = 'none';
  clearReader();
  const url = fileUrl(filename);

  if (isEpub(filename)) {
    state.renderMode = 'epub';
    $('#epub-reader').classList.add('show');
    renderEPUB(url, filename, state.requestId);
  } else if (isMobile()) {
    state.renderMode = 'pdf-mobile';
    $('#pdf-canvas-container').classList.add('show');
    renderMobilePDF(url, state.requestId);
  } else {
    state.renderMode = 'pdf-desktop';
    $('#pdf-frame').src = url;
    $('#pdf-frame').classList.add('show');
  }

  if (isMobile()) closeSidebar();
}

// EPUB 键盘导航
document.addEventListener('keydown', (event) => {
  if (!state.rendition || event.target.closest('button, input, textarea')) return;
  if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
    event.preventDefault();
    epubPrev();
  }
  if (event.key === 'ArrowRight' || event.key === 'PageDown') {
    event.preventDefault();
    epubNext();
  }
});

// 响应式重新渲染
window.addEventListener('resize', () => {
  const nextMode = state.activeFile
    ? isEpub(state.activeFile) ? 'epub' : isMobile() ? 'pdf-mobile' : 'pdf-desktop'
    : null;
  if (state.activeFile && nextMode !== state.renderMode) {
    const activeItem = document.querySelector(`[data-file="${CSS.escape(state.activeFile)}"]`);
    if (activeItem) openBook(state.activeFile, activeItem);
    return;
  }
  if (state.renderMode === 'pdf-mobile' && state.pdfUrl) {
    const container = $('#pdf-canvas-container');
    if (Math.abs(container.clientWidth - state.pdfViewportWidth) > 24) {
      clearTimeout(state.pdfResizeTimer);
      state.pdfResizeTimer = setTimeout(() => {
        const activeItem = document.querySelector(`[data-file="${CSS.escape(state.activeFile)}"]`);
        if (activeItem) openBook(state.activeFile, activeItem);
      }, 240);
    }
  } else if (state.rendition) {
    state.rendition.resize();
  }
});

// EPUB 控制按钮
$('#epub-prev').addEventListener('click', () => void epubPrev());
$('#epub-next').addEventListener('click', () => void epubNext());
$('#epub-chapter-prev').addEventListener('click', () => void epubChapterPrev());
$('#epub-chapter-next').addEventListener('click', () => void epubChapterNext());
$('#epub-page-input').addEventListener('change', (event) => void jumpToEPUBPage(event.target.value));
$('#epub-page-input').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void jumpToEPUBPage(event.target.value);
  }
});
$('#epub-mode-select').addEventListener('change', (event) => void setEPUBMode(event.target.value));
$('#epub-toc').addEventListener('click', () => toggleTOC());

// 点击目录浮层外的空白区域收起目录。
document.addEventListener('click', (event) => {
  const panel = $('#epub-toc-panel');
  if (!panel.classList.contains('show')) return;
  if (event.target.closest('#epub-toc-panel, #epub-toc')) return;
  toggleTOC(false);
});

// 初始化
initSidebar();
loadBookList(openBook);
