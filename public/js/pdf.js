// PDF 阅读模块：PDF.js Viewer 负责页面、文本层、缩放和目录，应用只负责外壳与进度。
import { state } from './state.js';
import { $ } from './utils.js';
import { updateBookProgress, markBookOpened } from './reading.js';
import { CustomSelect } from './select.js';
import { t } from './i18n.js';

const PDF_VERSION = '3.11.174';
const PDF_CORE_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDF_VERSION}/pdf.min.js`;
const PDF_VIEWER_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDF_VERSION}/pdf_viewer.min.js`;
const PDF_VIEWER_CSS_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDF_VERSION}/pdf_viewer.min.css`;
const PDF_WORKER_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDF_VERSION}/pdf.worker.min.js`;

let controlsBound = false;
let pdfLibrariesPromise = null;
let zoomSelect = null; // CustomSelect 实例

function loadScript(url, globalName) {
  if (window[globalName]) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = false;
    script.dataset.pdfDependency = globalName;
    script.addEventListener('load', () => {
      if (window[globalName]) resolve();
      else reject(new Error(`${globalName} 加载完成但未暴露全局对象`));
    }, { once: true });
    script.addEventListener('error', () => {
      reject(new Error(`无法加载 ${globalName}：${url}`));
    }, { once: true });
    document.head.appendChild(script);
  });
}

function ensurePDFViewerStyles() {
  if (document.querySelector('link[data-pdf-viewer-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = PDF_VIEWER_CSS_URL;
  link.dataset.pdfViewerCss = 'true';
  const appStyles = document.querySelector('link[href$="styles.css"]');
  if (appStyles) appStyles.before(link);
  else document.head.appendChild(link);
}

async function loadPDFLibraries() {
  if (!pdfLibrariesPromise) {
    pdfLibrariesPromise = (async () => {
      await loadScript(PDF_CORE_URL, 'pdfjsLib');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
      await loadScript(PDF_VIEWER_URL, 'pdfjsViewer');
      if (typeof window.pdfjsViewer.PDFViewer !== 'function') {
        throw new Error('PDF.js Viewer 未提供 PDFViewer');
      }
      ensurePDFViewerStyles();
    })().catch((error) => {
      pdfLibrariesPromise = null;
      throw error;
    });
  }
  return pdfLibrariesPromise;
}

function describePDFError(error) {
  const name = error?.name || '';
  const message = error?.message || '';
  if (/无法加载 pdfjsLib|pdfjsLib 加载/.test(message)) {
    return 'PDF.js 核心库加载失败，请检查网络或 CDN 资源';
  }
  if (/无法加载 pdfjsViewer|pdfjsViewer 加载/.test(message)) {
    return 'PDF.js Viewer 加载失败，请检查网络或 CDN 资源';
  }
  if (/worker/i.test(message)) {
    return 'PDF.js Worker 启动失败，请检查 Worker 资源或浏览器安全策略';
  }
  if (name === 'PasswordException') return 'PDF 受密码保护，当前阅读器无法打开';
  if (name === 'InvalidPDFException' || name === 'FormatError') return 'PDF 文件格式无效或文件内容不完整';
  if (name === 'MissingPDFException' || name === 'UnexpectedResponseException') {
    return 'PDF 文件请求失败，请检查文件路径和服务器响应';
  }
  if (/Failed to fetch|NetworkError|网络|请求失败/i.test(message)) {
    return 'PDF 文件请求失败，请检查文件路径和网络连接';
  }
  return message ? `PDF 加载失败：${message}` : 'PDF 加载失败，请查看控制台错误详情';
}

function updatePDFReadingUI(currentPage, totalPages, progress) {
  const safeProgress = Math.max(0, Math.min(1, Number(progress) || 0));
  const hasDocument = totalPages > 0;
  $('#pdf-page-input').value = currentPage > 0 ? String(currentPage) : '';
  $('#pdf-page-total').textContent = hasDocument ? String(totalPages) : '—';
  $('#pdf-page-input').max = hasDocument ? String(totalPages) : '';
  $('#pdf-progress-bar').style.width = `${safeProgress * 100}%`;
  $('#pdf-progress-value').textContent = `${Math.round(safeProgress * 100)}%`;
  
  const filename = state.pdfFilename || '';
  const metadata = state.booksMetadata?.[filename];
  let title = '—';
  
  if (metadata?.title) {
    title = metadata.title;
  } else if (filename) {
    const basename = filename.split('/').pop();
    const nameWithoutExt = basename.replace(/\.pdf$/i, '');
    title = nameWithoutExt.split('-')[0].trim();
  }
  
  $('#pdf-title').textContent = title;
}

function updatePDFDownloadLink(url, filename) {
  const link = $('#pdf-download');
  if (!link) return;
  if (url && filename) {
    link.href = url;
    link.download = filename.split('/').pop();
    link.removeAttribute('aria-disabled');
    link.style.pointerEvents = '';
    link.style.opacity = '';
  } else {
    link.removeAttribute('href');
    link.setAttribute('aria-disabled', 'true');
    link.style.pointerEvents = 'none';
    link.style.opacity = '0.4';
  }
}

function updatePDFRotationUI() {
  const rotation = state.pdfViewer?.pagesRotation || 0;
  const label = `${rotation}°`;
  const clockwise = $('#pdf-rotate-clockwise');
  clockwise.title = t('reader.rotateTitle', null, { angle: label });
  clockwise.setAttribute('aria-label', t('reader.rotateAriaLabel', null, { angle: label }));
}

function rotatePDF(delta) {
  const viewer = state.pdfViewer;
  if (!viewer) return;
  const currentRotation = Number(viewer.pagesRotation) || 0;
  const nextRotation = (currentRotation + delta + 360) % 360;
  viewer.pagesRotation = nextRotation;
  state.pdfRotation = nextRotation;
  updatePDFRotationUI();
  window.requestAnimationFrame(() => updatePDFPosition(viewer.currentPageNumber, { persist: false }));
}

function getPDFProgress() {
  const container = $('#pdf-viewer-container');
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const reachedEnd = container.scrollHeight > 0
    && (maxScrollTop === 0 || container.scrollTop + container.clientHeight >= container.scrollHeight - 8);
  return reachedEnd ? 1 : maxScrollTop === 0 ? 0 : container.scrollTop / maxScrollTop;
}

function updatePDFPosition(pageNumber = state.pdfViewer?.currentPageNumber || 1, { persist = true } = {}) {
  if (!state.activeFile || !state.pdfViewer || state.renderMode !== 'pdf') return;
  const progress = getPDFProgress();
  state.pdfCurrentPage = pageNumber;
  updatePDFReadingUI(pageNumber, state.pdfTotalPages, progress);
  if (persist && !state.pdfRestorePending) {
    updateBookProgress(state.activeFile, progress, { kind: 'pdf-page', value: pageNumber });
  }
}

function bindPDFProgress(requestId) {
  const container = $('#pdf-viewer-container');
  const checkProgress = () => {
    state.pdfScrollFrame = 0;
    if (requestId !== state.requestId) return;
    updatePDFPosition();
  };
  const handleScroll = () => {
    if (state.pdfScrollFrame) return;
    state.pdfScrollFrame = window.requestAnimationFrame(checkProgress);
  };
  state.pdfScrollHandler = handleScroll;
  container.addEventListener('scroll', handleScroll, { passive: true });
  window.requestAnimationFrame(checkProgress);
}

function schedulePDFPageRestore(pageNumber, requestId, viewer) {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      if (
        requestId !== state.requestId
        || state.pdfViewer !== viewer
        || !state.pdfRestorePending
      ) return;
      viewer.scrollPageIntoView({ pageNumber });
      window.requestAnimationFrame(() => {
        if (requestId !== state.requestId || state.pdfViewer !== viewer) return;
        state.pdfRestorePending = false;
        updatePDFPosition(pageNumber);
      });
    });
  });
}

export function togglePDFSidebar(force) {
  const sidebar = $('#pdf-sidebar');
  const show = typeof force === 'boolean' ? force : !sidebar.classList.contains('show');
  sidebar.classList.toggle('show', show);
  sidebar.setAttribute('aria-hidden', String(!show));
  $('#pdf-sidebar-toggle').setAttribute('aria-expanded', String(show));
}

function renderPDFOutline(outline) {
  const list = $('#pdf-outline');
  list.replaceChildren();
  if (!outline?.length) {
    const empty = document.createElement('li');
    empty.className = 'pdf-outline-empty';
    empty.textContent = t('reader.pdfNoOutline');
    list.appendChild(empty);
    return;
  }

  const appendItems = (items, parent, level = 0) => items.forEach((entry) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    item.className = 'pdf-outline-item';
    button.type = 'button';
    button.textContent = entry.title || '未命名目录项';
    button.style.paddingLeft = `${12 + level * 14}px`;
    button.addEventListener('click', () => {
      if (entry.dest && state.pdfLinkService) state.pdfLinkService.goToDestination(entry.dest);
      else if (entry.url) window.open(entry.url, '_blank', 'noopener,noreferrer');
      togglePDFSidebar(false);
    });
    item.appendChild(button);
    parent.appendChild(item);
    if (entry.items?.length) appendItems(entry.items, parent, level + 1);
  });
  appendItems(outline, list);
}

async function loadPDFOutline(pdf, requestId) {
  try {
    const outline = await pdf.getOutline();
    if (requestId === state.requestId && state.pdf === pdf) renderPDFOutline(outline);
  } catch (error) {
    if (requestId === state.requestId && state.pdf === pdf) {
      console.warn('PDF 目录加载失败:', error);
      renderPDFOutline(null);
    }
  }
}

// ---- 缩略图面板：懒加载渲染 + 受限并发 ----
let thumbnailObserver = null;   // IntersectionObserver，滚动进入视口才渲染
let thumbnailQueue = [];        // 待渲染任务队列
let thumbnailActive = 0;        // 当前并行渲染任务数
let thumbnailGeneration = 0;    // 代际号：切换/销毁文档时作废旧任务与 DOM
const THUMBNAIL_CONCURRENCY = 3;

function queueThumbnailTask(task) {
  thumbnailQueue.push(task);
  drainThumbnailQueue();
}

function drainThumbnailQueue() {
  while (thumbnailActive < THUMBNAIL_CONCURRENCY && thumbnailQueue.length) {
    const task = thumbnailQueue.shift();
    thumbnailActive += 1;
    Promise.resolve().then(task).finally(() => {
      thumbnailActive -= 1;
      drainThumbnailQueue();
    });
  }
}

function clearThumbnailTasks() {
  thumbnailQueue = [];
}

function renderThumbnailPage(pageNumber, canvas, generation) {
  queueThumbnailTask(async () => {
    const pdf = state.pdf;
    if (!pdf || generation !== thumbnailGeneration || state.pdf !== pdf) return;
    try {
      const page = await pdf.getPage(pageNumber);
      if (generation !== thumbnailGeneration || state.pdf !== pdf) return;
      const baseViewport = page.getViewport({ scale: 1 });
      const targetWidth = Math.max(180, canvas.clientWidth || 200);
      const viewport = page.getViewport({ scale: targetWidth / baseViewport.width });
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport }).promise;
    } catch (error) {
      if (generation === thumbnailGeneration) {
        console.warn(`PDF 第 ${pageNumber} 页缩略图渲染失败:`, error);
      }
    }
  });
}

function buildPDFThumbnails() {
  const panel = $('#pdf-thumbnails');
  destroyPDFThumbnails();
  const generation = ++thumbnailGeneration;
  panel.replaceChildren();
  for (let pageNumber = 1; pageNumber <= state.pdfTotalPages; pageNumber += 1) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pdf-thumb-item';
    button.dataset.page = String(pageNumber);
    button.setAttribute('aria-label', t('reader.jumpToPage', null, { page: pageNumber }));
    const frame = document.createElement('span');
    frame.className = 'pdf-thumb-frame';
    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-thumb-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    frame.appendChild(canvas);
    const label = document.createElement('span');
    label.className = 'pdf-thumb-label';
    label.textContent = String(pageNumber);
    button.append(frame, label);
    button.addEventListener('click', () => {
      if (state.pdfViewer) state.pdfViewer.scrollPageIntoView({ pageNumber });
      togglePDFSidebar(false);
    });
    panel.appendChild(button);
  }
  thumbnailObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const item = entry.target;
      thumbnailObserver?.unobserve(item);
      renderThumbnailPage(Number(item.dataset.page), item.querySelector('.pdf-thumb-canvas'), generation);
    }
  }, { root: panel, rootMargin: '160px 0px', threshold: 0.01 });
  panel.querySelectorAll('.pdf-thumb-item').forEach((item) => thumbnailObserver.observe(item));
}

function destroyPDFThumbnails() {
  thumbnailGeneration += 1;
  thumbnailObserver?.disconnect();
  thumbnailObserver = null;
  clearThumbnailTasks();
  $('#pdf-thumbnails').replaceChildren();
}

function bindPDFSidebarTabs() {
  const outlineTab = $('#pdf-tab-outline');
  const thumbsTab = $('#pdf-tab-thumbs');
  const outline = $('#pdf-outline');
  const panel = $('#pdf-thumbnails');
  const selectPanel = (showThumbs) => {
    outline.hidden = showThumbs;
    panel.hidden = !showThumbs;
    outlineTab.setAttribute('aria-selected', String(!showThumbs));
    thumbsTab.setAttribute('aria-selected', String(showThumbs));
  };
  outlineTab.addEventListener('click', () => selectPanel(false));
  thumbsTab.addEventListener('click', () => selectPanel(true));
}

function bindPDFControls() {
  if (controlsBound) return;
  controlsBound = true;
  bindPDFSidebarTabs();
  $('#pdf-sidebar-toggle').addEventListener('click', () => togglePDFSidebar());
  $('#pdf-page-input').addEventListener('change', (event) => {
    const page = Number.parseInt(event.target.value, 10);
    if (Number.isInteger(page) && page >= 1 && page <= state.pdfTotalPages && state.pdfViewer) {
      state.pdfViewer.currentPageNumber = page;
    } else {
      updatePDFReadingUI(state.pdfCurrentPage, state.pdfTotalPages, getPDFProgress());
    }
  });
  
  const zoomStep = 0.1;
  const minZoom = 0.5;
  const maxZoom = 4;
  
  const zoomIn = () => {
    if (!state.pdfViewer) return;
    state.pdfViewer.currentScale = Math.min(maxZoom, state.pdfViewer.currentScale + zoomStep);
  };
  
  const zoomOut = () => {
    if (!state.pdfViewer) return;
    state.pdfViewer.currentScale = Math.max(minZoom, state.pdfViewer.currentScale - zoomStep);
  };
  
  // 确保 PDF 侧边栏滚动完全独立，不受其他区域影响
  $('#pdf-sidebar').addEventListener('wheel', (event) => {
    event.stopPropagation();
  }, { passive: true });
  
  $('#pdf-sidebar').addEventListener('touchmove', (event) => {
    event.stopPropagation();
  }, { passive: true });
  
  // Ctrl/Cmd + 滚轮缩放（支持触控板双指捏合手势）
  // 只在主内容区域生效，不影响侧边栏滚动
  $('#pdf-viewer-container').addEventListener('wheel', (event) => {
    if (!state.pdfViewer) return;
    
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const delta = -event.deltaY;
      if (delta > 0) {
        zoomIn();
      } else if (delta < 0) {
        zoomOut();
      }
    }
  }, { passive: false });
  
  $('#pdf-rotate-clockwise').addEventListener('click', () => rotatePDF(90));

  // 初始化缩放自定义下拉
  const zoomWrap = $('#cs-zoom-wrap');
  zoomSelect = new CustomSelect(
    zoomWrap.querySelector('.cs-trigger'),
    zoomWrap.querySelector('.cs-listbox'),
    {
      theme: 'toolbar',
      onChange: (value) => {
        if (state.pdfViewer) state.pdfViewer.currentScaleValue = value;
      }
    }
  );
  zoomSelect.setOptions(getZoomOptions());
  zoomSelect.setValue('page-width', true);

  // 切换语言后，重新生成缩放模式选项文案（自定义下拉的选项是纯 JS 渲染，不会被 data-i18n 自动更新）
  window.addEventListener('languagechange', () => {
    zoomSelect?.setOptions(getZoomOptions());
  });
}

function getZoomOptions() {
  return [
    { value: 'auto',         label: t('reader.auto') },
    { value: 'page-width',   label: t('reader.fitWidth') },
    { value: 'page-fit',     label: t('reader.fitPage') },
    { value: 'page-actual',  label: t('reader.actualSize') }
  ];
}

function showPDFError(message) {
  const container = $('#pdf-viewer-container');
  container.replaceChildren();
  const error = document.createElement('div');
  error.className = 'reader-error';
  error.textContent = message;
  container.appendChild(error);
}

export async function renderPDF(url, filename, requestId, restoreLocation = null) {
  bindPDFControls();
  const viewerContainer = $('#pdf-viewer-container');
  viewerContainer.replaceChildren();
  const viewer = document.createElement('div');
  viewer.id = 'pdf-viewer';
  viewer.className = 'pdfViewer';
  viewerContainer.appendChild(viewer);
  state.pdfUrl = url;
  state.pdfFilename = filename;
  state.pdfCurrentPage = 0;
  state.pdfTotalPages = 0;
  state.pdfRotation = 0;
  state.pdfRestorePending = false;
  updatePDFDownloadLink(url, filename);
  $('#pdf-outline').replaceChildren();
  destroyPDFThumbnails();
  $('#pdf-tab-outline').setAttribute('aria-selected', 'true');
  $('#pdf-tab-thumbs').setAttribute('aria-selected', 'false');
  $('#pdf-outline').hidden = false;
  $('#pdf-thumbnails').hidden = true;
  updatePDFReadingUI(0, 0, 0);

  try {
    await loadPDFLibraries();
    if (requestId !== state.requestId) return;
    const { EventBus, PDFLinkService, PDFFindController, PDFViewer } = window.pdfjsViewer;
    const loading = window.pdfjsLib.getDocument({ url, disableAutoFetch: false, disableStream: false });
    state.pdfLoading = loading;
    const pdf = await loading.promise;
    if (state.pdfLoading === loading) state.pdfLoading = null;
    if (requestId !== state.requestId) {
      void pdf.destroy().catch((error) => console.warn('已取消 PDF 清理失败:', error));
      return;
    }
    state.pdf = pdf;
    if (requestId !== state.requestId) {
      void pdf.destroy();
      return;
    }
    state.pdfTotalPages = pdf.numPages;
    const restorePage = Number(restoreLocation?.kind === 'pdf-page' ? restoreLocation.value : 0);
    state.pdfRestorePending = Number.isInteger(restorePage)
      && restorePage >= 1
      && restorePage <= state.pdfTotalPages;
    state.pdfEventBus = new EventBus();
    state.pdfLinkService = new PDFLinkService({ eventBus: state.pdfEventBus });
    state.pdfFindController = new PDFFindController({
      eventBus: state.pdfEventBus,
      linkService: state.pdfLinkService
    });
    const pdfViewer = new PDFViewer({
      container: viewerContainer,
      eventBus: state.pdfEventBus,
      linkService: state.pdfLinkService,
      findController: state.pdfFindController,
      textLayerMode: 2,
      annotationMode: 2
    });
    state.pdfViewer = pdfViewer;
    state.pdfLinkService.setViewer(pdfViewer);
    const isCurrentViewer = () => requestId === state.requestId && state.pdfViewer === pdfViewer;
    state.pdfEventBus.on('pagechanging', ({ pageNumber }) => {
      if (isCurrentViewer()) updatePDFPosition(pageNumber);
    });
    state.pdfEventBus.on('updateviewarea', ({ location }) => {
      if (isCurrentViewer() && location?.pageNumber) updatePDFPosition(location.pageNumber);
    });
    state.pdfEventBus.on('pagesloaded', ({ pagesCount }) => {
      if (!isCurrentViewer()) return;
      state.pdfTotalPages = pagesCount;
      updatePDFReadingUI(state.pdfCurrentPage || 1, pagesCount, getPDFProgress());
      buildPDFThumbnails();
      void loadPDFOutline(pdf, requestId);
    });
    state.pdfEventBus.on('pagesinit', () => {
      if (!isCurrentViewer()) return;
      markBookOpened(filename);
      pdfViewer.currentScaleValue = 'page-width';
      if (zoomSelect) zoomSelect.setValue('page-width', true);
      const page = restorePage;
      const canRestore = state.pdfRestorePending;
      bindPDFProgress(requestId);
      updatePDFPosition(canRestore ? page : 1, { persist: !canRestore });
      if (canRestore) {
        schedulePDFPageRestore(page, requestId, pdfViewer);
      }
    });
    pdfViewer.setDocument(pdf);
    state.pdfLinkService.setDocument(pdf, null);
    state.pdfViewer.pagesRotation = state.pdfRotation;
    updatePDFRotationUI();
  } catch (error) {
    if (requestId !== state.requestId) return;
    console.error('PDF Viewer 渲染失败:', {
      url,
      filename,
      errorName: error?.name,
      errorMessage: error?.message,
      error
    });
    if (state.pdfViewer || state.pdf || state.pdfLoading) destroyPDF();
    showPDFError(describePDFError(error));
  }
}

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

function detachPDFViewer(viewer) {
  if (!viewer) return;
  try {
    viewer.setDocument(null);
  } catch (error) {
    // PDF.js 3.11.174 在部分已完成渲染状态下会重复销毁内部页面。
    // 这里允许 DOM 清理继续执行，避免旧文档阻断新阅读器切换。
    console.warn('PDF Viewer 重置失败:', error);
  }
}

export function destroyPDF() {
  if (state.pdfScrollHandler) {
    $('#pdf-viewer-container').removeEventListener('scroll', state.pdfScrollHandler);
    state.pdfScrollHandler = null;
  }
  if (state.pdfScrollFrame) cancelAnimationFrame(state.pdfScrollFrame);
  state.pdfScrollFrame = 0;
  destroyPDFThumbnails();

  const viewer = state.pdfViewer;
  const linkService = state.pdfLinkService;
  const pdf = state.pdf;
  const loading = state.pdfLoading;
  detachPDFViewer(viewer);
  try {
    linkService?.setDocument(null, null);
    linkService?.setViewer(null);
  } catch (error) {
    console.warn('PDF 链接服务重置失败:', error);
  }
  safelyDestroy(pdf, 'PDF 文档');
  if (loading && loading !== pdf) safelyDestroy(loading, 'PDF 加载任务');
  state.pdfViewer = null;
  state.pdfEventBus = null;
  state.pdfLinkService = null;
  state.pdfFindController = null;
  state.pdf = null;
  state.pdfLoading = null;
  state.pdfUrl = null;
  state.pdfFilename = null;
  state.pdfViewportWidth = 0;
  state.pdfCurrentPage = 0;
  state.pdfTotalPages = 0;
  state.pdfRotation = 0;
  state.pdfRestorePending = false;
  updatePDFReadingUI(0, 0, 0);
  updatePDFRotationUI();
  updatePDFDownloadLink(null, null);
  $('#pdf-sidebar').classList.remove('show');
  $('#pdf-sidebar').setAttribute('aria-hidden', 'true');
  $('#pdf-sidebar-toggle').setAttribute('aria-expanded', 'false');
}
