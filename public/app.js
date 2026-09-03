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
import { renderMOBI, destroyMOBI, resetMobiState, toggleMobiTOC, mobiNext, mobiPrev } from './js/mobi.js?v=23';
import { initSidebar, closeSidebar } from './js/sidebar.js';
import { loadBookList } from './js/library.js';
import { getBookReadingLocation } from './js/reading.js';
import { initTooltips } from './js/tooltip.js';
import { initConfig, config } from './js/config-init.js';
import { initLocalLibrary, clearLocalActiveState } from './js/local-library.js';
import { initI18n, setLanguage, getCurrentLanguage, supportedLanguages, updateDOMTranslations } from './js/i18n.js';

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

// 上次各 tab 打开的书，用于切换 tab 时恢复
const lastOpenedByTab = { online: null, local: null };

function updateSourceBadge(filename) {
  const isLocal = filename?.startsWith('__local__/');
  // 在线：地球仪 SVG；本地：显示器 SVG（与 tab 图标一致）
  const onlineSvg = `<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
  const localSvg  = `<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`;

  ['pdf', 'epub', 'mobi'].forEach(type => {
    const icon = $(`#reader-source-icon-${type}`);
    if (!icon) return;
    if (!filename) {
      icon.hidden = true;
      return;
    }
    icon.hidden = false;
    icon.className = `reader-source-icon reader-source-icon--${isLocal ? 'local' : 'online'}`;
    icon.innerHTML = isLocal ? localSvg : onlineSvg;
  });
}

function openBook(filename, item) {
  document.querySelectorAll('.book-item').forEach((element) => element.classList.remove('active'));
  item.classList.add('active');
  clearLocalActiveState();
  const savedLocation = getBookReadingLocation(filename);
  $('#empty-state').style.display = 'none';
  clearReader();
  state.activeFile = filename;
  lastOpenedByTab.online = { filename, item };
  updateSourceBadge(filename);
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
  lastOpenedByTab.local = { url, filename, displayName, file };
  updateSourceBadge(filename);

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
    const key = event.key?.toLowerCase?.() ?? '';
    const codeDirection = { KeyW: -1, KeyA: -1, KeyS: 1, KeyD: 1 }[event.code];
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'PageUp'
      || key === 'w' || key === 'a' || codeDirection === -1) {
      event.preventDefault();
      mobiPrev();
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'PageDown'
      || key === 's' || key === 'd' || codeDirection === 1) {
      event.preventDefault();
      mobiNext();
    }
    return;
  }

  // EPUB 导航
  if (state.rendition) {
    const key = event.key?.toLowerCase?.() ?? '';
    const codeDirection = { KeyW: -1, KeyA: -1, KeyS: 1, KeyD: 1 }[event.code];
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'PageUp'
      || key === 'w' || key === 'a' || codeDirection === -1) {
      event.preventDefault();
      epubPrev();
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'PageDown'
      || key === 's' || key === 'd' || codeDirection === 1) {
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
    && !event.target.closest('#mobi-toc, #mobi-toc-list button')) {
    toggleMobiTOC(false);
  }
});

// 切换书库 tab 时，若当前打开的书不属于该书库则清空阅读区；切回时恢复上次阅读
window.addEventListener('librarytabchange', ({ detail }) => {
  const { tab } = detail;
  const file = state.activeFile;
  const isLocal = file?.startsWith('__local__/');

  // 当前书不属于目标 tab，清空
  if (file && ((tab === 'local' && !isLocal) || (tab === 'online' && isLocal))) {
    clearReader();
    $('#empty-state').style.display = 'flex';
    updateSourceBadge(null);
  }

  // 切回目标 tab 时，若该 tab 上次有打开的书则恢复
  if (tab === 'online' && lastOpenedByTab.online) {
    const { filename, item } = lastOpenedByTab.online;
    // item 可能已被重渲染而失效，尝试从 DOM 重新查找
    const liveItem = document.querySelector(`.book-item[data-file="${CSS.escape(filename)}"]`) || item;
    if (liveItem) openBook(filename, liveItem);
  } else if (tab === 'local' && lastOpenedByTab.local) {
    openLocalBook(lastOpenedByTab.local);
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
document.addEventListener('DOMContentLoaded', async () => {
  console.log('DOM加载完成，开始初始化...');
  initConfig();
  initTooltips();
  initSidebar();

  // 初始化 i18n
  await initI18n();
  document.documentElement.classList.add('app-ready');

  // 初始化语言切换器
  initLanguageSelector();

  loadBookList(openBook);
  void initLocalLibrary(openLocalBook);
});

// 语言切换器初始化
function initLanguageSelector() {
  const languageToggle = $('#language-toggle');
  const languageDropdown = $('#language-dropdown');
  const currentLanguageFlag = $('#current-language-flag');
  const languageOptions = document.querySelectorAll('.language-option');

  if (!languageToggle || !languageDropdown) return;

  // 更新当前语言显示
  function updateCurrentLanguageDisplay() {
    const currentLang = getCurrentLanguage();
    const langConfig = supportedLanguages.find(l => l.code === currentLang);
    if (langConfig && currentLanguageFlag) {
      currentLanguageFlag.src = langConfig.icon;
    }

    // 更新选项的选中状态
    languageOptions.forEach(option => {
      const isSelected = option.getAttribute('data-lang') === currentLang;
      option.setAttribute('aria-selected', isSelected);
    });
  }

  // 切换下拉菜单显示
  languageToggle.addEventListener('click', () => {
    const isExpanded = languageToggle.getAttribute('aria-expanded') === 'true';
    languageToggle.setAttribute('aria-expanded', !isExpanded);
    languageDropdown.hidden = isExpanded;
  });

  // 点击外部关闭下拉菜单
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.language-selector')) {
      languageToggle.setAttribute('aria-expanded', 'false');
      languageDropdown.hidden = true;
    }
  });

  // 语言选项点击事件
  languageOptions.forEach(option => {
    option.addEventListener('click', async () => {
      const lang = option.getAttribute('data-lang');
      if (lang && lang !== getCurrentLanguage()) {
        await setLanguage(lang);
        updateCurrentLanguageDisplay();
        updateDOMTranslations();
      }
      languageToggle.setAttribute('aria-expanded', 'false');
      languageDropdown.hidden = true;
    });
  });

  // 初始化显示
  updateCurrentLanguageDisplay();
}
