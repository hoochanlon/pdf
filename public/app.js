// 主入口文件
console.log('app.js 开始加载...');

import { state } from './js/state.js';
import { $, fileUrl, isEpub, isMobi, isMobile } from './js/utils.js';
import { destroyPDF, renderPDF, togglePDFSidebar } from './js/pdf.js';
import {
  renderEPUB,
  epubNext,
  epubPrev,
  epubChapterNext,
  epubChapterPrev,
  jumpToEPUBPage,
  resetEPUBState,
  toggleTOC
} from './js/epub.js?v=15';
import { renderMOBI, destroyMOBI, resetMobiState, toggleMobiTOC, mobiNext, mobiPrev } from './js/mobi.js?v=22';
import { initSidebar, closeSidebar } from './js/sidebar.js';
import { loadBookList } from './js/library.js';
import { getBookReadingLocation } from './js/reading.js';
import { initTooltips } from './js/tooltip.js';
import { initConfig, config } from './js/config-init.js';
import { initLocalLibrary, clearLocalActiveState } from './js/local-library.js';

console.log('app.js 所有模块导入完成');

function safelyDestroy(resource, label) {
  if (!resource?.destroy) return;
  try {
    const result = resource.destroy();
    if (result?.catch) {
      void result.catch((error) => console.warn(`${label}清理失败:`, error));
    }
  } catch (error) {
    console.warn(`${label}清理失败:`, error);
  }
}

function clearReader() {
  state.requestId += 1;
  state.activeFile = null;
  state.renderMode = null;
  const rendition = state.rendition;
  const book = state.book;
  state.rendition = null;
  state.book = null;

  // 先切断可见出口，再清理异步资源；任何清理异常都不能阻断下一本书。
  showReader(null);
  toggleTOC(false);
  $('#pdf-viewer-container').replaceChildren();
  $('#epub-container').replaceChildren();
  $('#mobi-container').replaceChildren();
  destroyPDF();
  destroyMOBI();
  state.epubResizeObservers.forEach((observer) => observer.disconnect());
  state.epubResizeObservers.clear();
  resetEPUBState();
  resetMobiState();
  safelyDestroy(rendition, 'EPUB 阅读器');
  safelyDestroy(book, 'EPUB 文档');
}

function showReader(mode) {
  const pdfReader = $('#pdf-reader');
  const epubReader = $('#epub-reader');
  const mobiReader = $('#mobi-reader');
  pdfReader.classList.toggle('show', mode === 'pdf');
  epubReader.classList.toggle('show', mode === 'epub');
  mobiReader.classList.toggle('show', mode === 'mobi');
}

function openBook(filename, item) {
  document.querySelectorAll('.book-item').forEach((element) => element.classList.remove('active'));
  item.classList.add('active');
  clearLocalActiveState();
  const savedLocation = getBookReadingLocation(filename);
  $('#empty-state').style.display = 'none';
  clearReader();
  state.activeFile = filename;
  const url = fileUrl(filename);

  if (isMobi(filename)) {
    state.renderMode = 'mobi';
    showReader('mobi');
    void renderMOBI(url, filename, state.requestId, savedLocation);
  } else if (isEpub(filename)) {
    state.renderMode = 'epub';
    showReader('epub');
    void renderEPUB(url, filename, state.requestId, savedLocation);
  } else {
    state.renderMode = 'pdf';
    showReader('pdf');
    void renderPDF(url, filename, state.requestId, savedLocation);
  }

  if (isMobile()) closeSidebar();
}

// 打开本地文件（来自 local-library.js 的回调）
function openLocalBook({ url, filename, displayName, file }) {
  // 取消远程书架的 active 高亮
  document.querySelectorAll('.book-item:not(.local-book-item)').forEach((el) => el.classList.remove('active'));
  const savedLocation = getBookReadingLocation(filename);
  $('#empty-state').style.display = 'none';
  clearReader();
  state.activeFile = filename;

  // 把显示名注入 metadata，供阅读器工具栏显示正确书名
  const base = displayName.replace(/\.[^.]+$/, '');
  const sep = Math.max(base.lastIndexOf('-'), base.lastIndexOf('—'), base.lastIndexOf('–'));
  const title = sep > 0 ? base.slice(0, sep).trim() : base;
  const author = sep > 0 ? base.slice(sep + 1).trim() : '';
  state.booksMetadata[filename] = { title, author, category: '本地文件' };

  if (isMobi(displayName)) {
    state.renderMode = 'mobi';
    showReader('mobi');
    void renderMOBI(url, filename, state.requestId, savedLocation);
  } else if (isEpub(displayName)) {
    state.renderMode = 'epub';
    showReader('epub');
    // 传入原始 File 对象，让 renderEPUB 直接读 ArrayBuffer，避免 blob URL fetch 超时
    void renderEPUB(url, filename, state.requestId, savedLocation, file);
  } else {
    state.renderMode = 'pdf';
    showReader('pdf');
    void renderPDF(url, filename, state.requestId, savedLocation);
  }

  if (isMobile()) closeSidebar();
}

// 阅读器键盘导航
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if ($('#pdf-sidebar').classList.contains('show')) togglePDFSidebar(false);
    if ($('#epub-sidebar').classList.contains('show')) toggleTOC(false);
    return;
  }
  if (event.target.closest?.('button, input, textarea, select')) return;
  
  // PDF 缩放快捷键：Ctrl/Cmd + 和 Ctrl/Cmd -
  if (state.renderMode === 'pdf' && state.pdfViewer && (event.ctrlKey || event.metaKey)) {
    if (event.key === '=' || event.key === '+') {
      event.preventDefault();
      state.pdfViewer.currentScale = Math.min(4, state.pdfViewer.currentScale + 0.1);
      return;
    }
    if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      state.pdfViewer.currentScale = Math.max(0.5, state.pdfViewer.currentScale - 0.1);
      return;
    }
  }
  
  // PDF 导航
  if (state.renderMode === 'pdf' && state.pdfViewer) {
    const pdfDirection = { ArrowLeft: -1, PageUp: -1, ArrowRight: 1, PageDown: 1 }[event.key];
    if (pdfDirection) {
      event.preventDefault();
      if (pdfDirection < 0) state.pdfViewer.previousPage();
      else state.pdfViewer.nextPage();
    }
    return;
  }
  
  // MOBI 导航
  if (state.renderMode === 'mobi' && state.mobiView) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'PageUp') {
      event.preventDefault();
      state.mobiView.goLeft?.();
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'PageDown') {
      event.preventDefault();
      state.mobiView.goRight?.();
    }
    return;
  }
  
  // EPUB 导航
  if (state.rendition) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'PageUp') {
      event.preventDefault();
      epubPrev();
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'PageDown') {
      event.preventDefault();
      epubNext();
    }
  }
});

// 响应式重新渲染
window.addEventListener('resize', () => {
  const nextMode = state.activeFile
    ? isMobi(state.activeFile) ? 'mobi' : isEpub(state.activeFile) ? 'epub' : 'pdf'
    : null;
  if (state.activeFile && nextMode !== state.renderMode) {
    const activeItem = document.querySelector(`[data-file="${CSS.escape(state.activeFile)}"]`);
    if (activeItem) openBook(state.activeFile, activeItem);
    return;
  }
  if (state.renderMode === 'pdf' && state.pdfViewer) {
    clearTimeout(state.pdfResizeTimer);
    const requestId = state.requestId;
    const viewer = state.pdfViewer;
    state.pdfResizeTimer = setTimeout(() => {
      if (requestId !== state.requestId || state.pdfViewer !== viewer) return;
      const page = viewer.currentPageNumber;
      if (viewer.currentScaleValue === 'auto') {
        viewer.currentScaleValue = 'auto';
      }
      viewer.currentPageNumber = page;
      state.pdfViewportWidth = $('#pdf-viewer-container').clientWidth;
    }, 120);
  } else if (state.rendition) {
    state.rendition.resize();
  }
});

// EPUB 控制按钮
$('#epub-toc').addEventListener('click', () => toggleTOC());

// MOBI 控制按钮
$('#mobi-toc').addEventListener('click', () => toggleMobiTOC());

// 点击目录侧栏外的空白区域收起目录。
document.addEventListener('click', (event) => {
  const pdfSidebar = $('#pdf-sidebar');
  if (pdfSidebar.classList.contains('show')
    && !event.target.closest('#pdf-sidebar, #pdf-sidebar-toggle')) {
    togglePDFSidebar(false);
  }
  const epubSidebar = $('#epub-sidebar');
  if (epubSidebar.classList.contains('show')
    && !event.target.closest('#epub-sidebar, #epub-toc')) {
    toggleTOC(false);
  }
  const mobiSidebar = $('#mobi-sidebar');
  if (mobiSidebar.classList.contains('show')
    && !event.target.closest('#mobi-sidebar, #mobi-toc')) {
    toggleMobiTOC(false);
  }
});

// 阅读进度被清除时，若当前正在阅读该书则立即跳回起始位置
window.addEventListener('bookreadingchange', ({ detail }) => {
  const file = detail?.file;
  if (!file || !detail?.cleared || file !== state.activeFile) return;
  if (state.renderMode === 'pdf' && state.pdfViewer) {
    state.pdfViewer.scrollPageIntoView({ pageNumber: 1 });
  } else if (state.renderMode === 'epub' && state.rendition) {
    const firstChapter = state.epubChapters?.[0];
    if (firstChapter) {
      void state.rendition.display(firstChapter.href).catch(() => {});
    } else {
      void state.rendition.display(0).catch(() => {});
    }
  } else if (state.renderMode === 'mobi' && state.mobiView) {
    state.mobiView.goToFraction?.(0);
  }
});

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM加载完成，开始初始化...');
  initConfig();
  initTooltips();
  initSidebar();
  loadBookList(openBook);
  void initLocalLibrary(openLocalBook);
});
