// EPUB 渲染模块
import { state } from './state.js';
import { $ } from './utils.js';

async function waitForLibrary(name, predicate, timeout = 8000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= timeout) {
      throw new Error(`${name} 加载超时`);
    }
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
}

async function waitForStage(promise, stage, timeout = 15000) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(`${stage}超时`)), timeout);
  });
  return Promise.race([Promise.resolve(promise), timeoutPromise]).finally(() => window.clearTimeout(timer));
}

function setEPUBStatus(status, title, detail = '') {
  state.epubStatus = status;
  const panel = $('#epub-status');
  panel.classList.toggle('is-hidden', status === 'ready');
  panel.classList.toggle('is-error', status === 'error');
  $('#epub-status-title').textContent = title;
  $('#epub-status-detail').textContent = detail;
}

function setEPUBPage(current, total) {
  const input = $('#epub-page-input');
  const output = $('#epub-page-total');
  const location = $('#epub-location');
  const ready = state.epubLocationsReady && total > 0;
  const safeCurrent = ready ? Math.max(1, current) : current;
  input.disabled = !ready;
  input.max = ready ? String(total) : '';
  input.value = safeCurrent > 0 ? String(safeCurrent) : '';
  output.textContent = ready ? String(total) : '—';
  location.textContent = ready ? `第 ${safeCurrent} / ${total} 页` : '页码生成中…';
}

function updateEPUBModeControl() {
  $('#epub-mode-select').value = state.epubMode;
  $('#epub-mode-select').setAttribute('aria-label', `当前模式：${state.epubMode === 'scroll' ? '连续滚动' : '分页阅读'}`);
}

function cfiValue(cfi) {
  return typeof cfi === 'string' ? cfi : cfi?.toString?.() || '';
}

function installEPUBStyles(contents) {
  contents.addStylesheetRules({
    html: {
      height: 'auto !important',
      'min-height': '100% !important',
      overflow: 'visible !important'
    },
    body: {
      'font-family': '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif !important',
      'font-size': 'clamp(16px, 1.15vw, 19px) !important',
      'line-height': '1.85 !important',
      color: '#263247 !important',
      padding: 'clamp(24px, 5vw, 72px) clamp(18px, 7vw, 96px) !important',
      margin: '0 auto !important',
      'max-width': '820px !important',
      background: '#fffdf9 !important',
      overflow: 'visible !important',
      'touch-action': state.epubMode === 'paginated' ? 'none !important' : 'auto !important',
      'user-select': state.epubMode === 'paginated' ? 'none !important' : 'text !important',
      '-webkit-user-select': state.epubMode === 'paginated' ? 'none !important' : 'text !important',
      '-webkit-touch-callout': state.epubMode === 'paginated' ? 'none !important' : 'default !important'
    },
    'img, svg, video': { 'max-width': '100% !important', height: 'auto !important' },
    'p, li, blockquote': { 'overflow-wrap': 'break-word !important' },
    'h1, h2, h3, h4': { 'line-height': '1.35 !important', 'margin-top': '1.6em !important' }
  });

  // 保持每个章节 iframe 的高度，但不拦截 iframe 的原生滚动事件。
  try {
    const frameWindow = contents.window;
    const frameDocument = contents.document;
    const frame = frameWindow.frameElement;
    if (!frame) return;
    installEPUBSwipeNavigation(frameDocument);
    frame.style.touchAction = state.epubMode === 'paginated' ? 'none' : '';
    frame.style.userSelect = state.epubMode === 'paginated' ? 'none' : '';
    frame.style.webkitUserSelect = state.epubMode === 'paginated' ? 'none' : '';
    const syncFrameHeight = () => {
      const root = frameDocument.documentElement;
      const body = frameDocument.body;
      const height = Math.max(
        root?.scrollHeight || 0,
        root?.offsetHeight || 0,
        body?.scrollHeight || 0,
        body?.offsetHeight || 0
      );
      frame.style.height = `${Math.max(height, 1)}px`;
    };
    frameWindow.addEventListener('load', syncFrameHeight, { once: true });
    window.setTimeout(syncFrameHeight, 0);
    window.setTimeout(syncFrameHeight, 300);
    if (window.ResizeObserver) {
      const resizeObserver = new ResizeObserver(syncFrameHeight);
      resizeObserver.observe(frameDocument.documentElement);
      if (frameDocument.body) resizeObserver.observe(frameDocument.body);
      state.epubResizeObservers.add(resizeObserver);
    }
  } catch (error) {
    console.warn('EPUB 内容尺寸同步失败:', error);
  }
}

let lastEPUBSwipeAt = 0;

function installEPUBSwipeNavigation(frameDocument) {
  const frameWindow = frameDocument.defaultView;
  let gesture = null;
  let suppressClickUntil = 0;

  const isInteractiveTarget = (target) => target?.nodeType === 1
    && Boolean(target.closest('a, button, input, select, textarea'));
  const isHorizontalSwipe = (distanceX, distanceY) => (
    Math.abs(distanceX) >= 56 && Math.abs(distanceX) > Math.abs(distanceY) * 1.25
  );
  const navigateBySwipe = (distanceX, distanceY, event, target) => {
    if (!isHorizontalSwipe(distanceX, distanceY) || isInteractiveTarget(target)) return;
    if (Date.now() - lastEPUBSwipeAt < 360) return;

    lastEPUBSwipeAt = Date.now();
    suppressClickUntil = lastEPUBSwipeAt + 360;
    if (event.cancelable) event.preventDefault();
    void (distanceX < 0 ? epubNext() : epubPrev());
  };
  const suppressDraggedClick = (event) => {
    if (Date.now() >= suppressClickUntil) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClickUntil = 0;
  };

  if ('PointerEvent' in frameWindow) {
    const reset = () => { gesture = null; };
    frameDocument.addEventListener('pointerdown', (event) => {
      if (state.epubMode !== 'paginated' || event.isPrimary === false
        || (event.pointerType === 'mouse' && event.button !== 0)
        || isInteractiveTarget(event.target)) return;
      gesture = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        target: event.target
      };
      event.target?.setPointerCapture?.(event.pointerId);
    }, { passive: true });
    frameDocument.addEventListener('pointermove', (event) => {
      if (!gesture || event.pointerId !== gesture.id) return;
      const distanceX = event.clientX - gesture.x;
      const distanceY = event.clientY - gesture.y;
      if (isHorizontalSwipe(distanceX, distanceY) && event.cancelable) event.preventDefault();
    }, { passive: false });
    frameDocument.addEventListener('pointerup', (event) => {
      if (!gesture || event.pointerId !== gesture.id) return;
      const current = gesture;
      reset();
      navigateBySwipe(
        event.clientX - current.x,
        event.clientY - current.y,
        event,
        current.target
      );
    }, { passive: false });
    frameDocument.addEventListener('pointercancel', reset, { passive: true });
  } else {
    let touchStart = null;
    const resetTouch = () => { touchStart = null; };
    frameDocument.addEventListener('touchstart', (event) => {
      if (state.epubMode !== 'paginated' || event.touches.length !== 1
        || isInteractiveTarget(event.target)) return;
      const touch = event.touches[0];
      touchStart = { x: touch.clientX, y: touch.clientY, target: event.target };
    }, { passive: true });
    frameDocument.addEventListener('touchend', (event) => {
      if (!touchStart || event.changedTouches.length !== 1) {
        resetTouch();
        return;
      }
      const touch = event.changedTouches[0];
      const current = touchStart;
      resetTouch();
      navigateBySwipe(
        touch.clientX - current.x,
        touch.clientY - current.y,
        event,
        current.target
      );
    }, { passive: false });
    frameDocument.addEventListener('touchcancel', resetTouch, { passive: true });
  }

  frameDocument.addEventListener('click', suppressDraggedClick, true);
}

export async function renderEPUB(url, filename, requestId, mode = state.epubMode, restoreLocation = null) {
  const container = $('#epub-container');
  const resumeLocation = cfiValue(restoreLocation);
  state.epubMode = mode;
  state.epubUrl = url;
  $('#epub-reader').dataset.mode = mode;
  $('#epub-reader').classList.toggle('mode-scroll', mode === 'scroll');
  $('#epub-reader').classList.toggle('mode-paginated', mode === 'paginated');
  state.epubLocation = null;
  state.epubCurrentPage = 0;
  state.epubTotalPages = 0;
  state.epubLocationsReady = false;
  state.epubChapters = [];
  state.epubRenderToken += 1;
  const renderToken = state.epubRenderToken;
  updateEPUBModeControl();
  setEPUBPage(0, 0);
  setEPUBStatus('loading', '正在加载 EPUB', '正在准备阅读内容…');
  container.replaceChildren();

  try {
    await waitForLibrary('JSZip', () => typeof window.JSZip === 'function');
    await waitForLibrary('ePub', () => typeof window.ePub === 'function');
    if (requestId !== state.requestId || renderToken !== state.epubRenderToken) return;

    const book = window.ePub(url);
    state.book = book;
    const rendition = book.renderTo(container, {
      width: '100%',
      height: '100%',
      flow: mode === 'scroll' ? 'scrolled-doc' : 'paginated',
      manager: mode === 'scroll' ? 'continuous' : 'default',
      spread: 'none',
      allowScriptedContent: false
    });
    state.rendition = rendition;
    rendition.hooks.content.register(installEPUBStyles);
    rendition.on('relocated', updateEPUBLocation);
    rendition.on('displayError', (error) => {
      console.error('EPUB 页面渲染失败:', error);
      setEPUBStatus('error', 'EPUB 页面渲染失败', error?.message || '章节内容无法显示');
    });

    await waitForStage(book.ready, '读取 EPUB 文件');
    if (requestId !== state.requestId || renderToken !== state.epubRenderToken) return;
    const title = book.package?.metadata?.title || book.metadata?.title || filename;
    $('#epub-title').textContent = title;

    await waitForStage(rendition.display(resumeLocation || undefined), '渲染 EPUB 内容');
    if (requestId !== state.requestId || renderToken !== state.epubRenderToken) return;
    setEPUBStatus('ready');
    void loadEPUBTOC(book, requestId, renderToken).catch((error) => {
      console.warn('EPUB 目录加载失败:', error);
    });
    void generateEPUBLocations(book, requestId, renderToken);
  } catch (error) {
    if (requestId !== state.requestId || renderToken !== state.epubRenderToken) return;
    console.error('EPUB 渲染失败:', error);
    setEPUBStatus('error', 'EPUB 加载失败', error.message || '文件无法解析');
  }
}

async function loadEPUBTOC(book, requestId, renderToken) {
  const list = $('#epub-toc-list');
  list.replaceChildren();
  const navigation = await waitForStage(book.loaded.navigation, '读取 EPUB 目录', 10000);
  if (requestId !== state.requestId || renderToken !== state.epubRenderToken) return;
  const items = navigation?.toc || [];
  const chapters = [];
  if (!items.length) {
    state.epubChapters = [];
    list.innerHTML = '<li class="epub-toc-empty">暂无目录</li>';
    updateEPUBChapterControls();
    return;
  }
  const appendItems = (entries, level = 0) => entries.forEach((entry) => {
    const chapter = {
      href: entry.href,
      label: entry.label?.trim() || '未命名章节',
      level,
      spineIndex: book.spine.get(entry.href)?.index ?? chapters.length
    };
    chapters.push(chapter);
    const item = document.createElement('li');
    item.className = 'epub-toc-item';
    item.style.paddingLeft = `${20 + level * 16}px`;
    item.textContent = chapter.label;
    item.addEventListener('click', () => {
      if (state.rendition) void state.rendition.display(chapter.href);
      toggleTOC(false);
    });
    list.appendChild(item);
    if (entry.subitems?.length) appendItems(entry.subitems, level + 1);
  });
  appendItems(items);
  state.epubChapters = chapters;
  updateEPUBChapterControls();
  const current = state.rendition?.currentLocation?.();
  if (current?.then) void current.then(updateEPUBLocation);
  else if (current) updateEPUBLocation(current);
}

async function generateEPUBLocations(book, requestId, renderToken) {
  const run = async () => {
    try {
      const locations = await waitForStage(book.locations.generate(1200), '生成 EPUB 页码', 30000);
      if (requestId !== state.requestId || renderToken !== state.epubRenderToken) return;
      state.epubLocationsReady = locations.length > 1;
      state.epubTotalPages = Math.max(0, book.locations.length() - 1);
      const current = state.rendition?.currentLocation?.();
      if (current?.then) updateEPUBLocation(await current);
      else if (current) updateEPUBLocation(current);
      else setEPUBPage(0, state.epubTotalPages);
    } catch (error) {
      if (requestId === state.requestId && renderToken === state.epubRenderToken) {
        console.warn('EPUB 页码生成失败:', error);
        state.epubStatus = 'ready';
        setEPUBPage(0, 0);
        $('#epub-location').textContent = '页码不可用';
      }
    }
  };
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 1800 });
  else window.setTimeout(run, 500);
}

function updateEPUBLocation(location) {
  const start = location?.start;
  if (!start) return;
  const cfi = cfiValue(start.cfi);
  if (cfi) state.epubLocation = cfi;
  const startIndex = Number(start.index);
  if (Number.isInteger(startIndex)) {
    state.epubCurrentChapter = state.epubChapters.findIndex((chapter) => chapter.spineIndex === startIndex);
  }

  let percentage = start.percentage;
  if (typeof percentage !== 'number' && state.epubLocationsReady && cfi) {
    percentage = state.book.locations.percentageFromCfi(cfi);
  }
  if (typeof percentage === 'number') {
    const progress = Math.max(0, Math.min(1, percentage));
    $('#epub-progress-bar').style.width = `${progress * 100}%`;
  }

  if (state.epubLocationsReady && cfi) {
    const locationIndex = state.book.locations.locationFromCfi(cfi);
    state.epubCurrentPage = Math.max(1, Math.min(state.epubTotalPages, locationIndex + 1));
  }
  setEPUBPage(state.epubCurrentPage, state.epubTotalPages);
  updateEPUBChapterControls();
}

function updateEPUBChapterControls() {
  const hasChapters = state.epubChapters.length > 0;
  const current = state.epubCurrentChapter;
  $('#epub-chapter-prev').disabled = !hasChapters || current <= 0;
  $('#epub-chapter-next').disabled = !hasChapters || current < 0 || current >= state.epubChapters.length - 1;
}

export async function jumpToEPUBPage(value) {
  if (!state.rendition || !state.epubLocationsReady) return;
  const page = Number.parseInt(value, 10);
  if (!Number.isInteger(page) || page < 1 || page > state.epubTotalPages) {
    setEPUBPage(state.epubCurrentPage, state.epubTotalPages);
    return;
  }
  const cfi = state.book.locations.cfiFromLocation(Math.min(page - 1, state.epubTotalPages));
  if (cfi && cfi !== -1) await state.rendition.display(cfiValue(cfi));
}

export async function epubNext() {
  if (!state.rendition) return;
  if (state.epubMode === 'paginated') {
    await state.rendition.next();
    return;
  }
  const container = $('#epub-container');
  container.scrollBy({ top: Math.max(container.clientHeight * 0.86, 240), behavior: 'smooth' });
}

export async function epubPrev() {
  if (!state.rendition) return;
  if (state.epubMode === 'paginated') {
    await state.rendition.prev();
    return;
  }
  const container = $('#epub-container');
  container.scrollBy({ top: -Math.max(container.clientHeight * 0.86, 240), behavior: 'smooth' });
}

export async function epubChapterNext() {
  const current = state.epubCurrentChapter;
  const target = state.epubChapters[current + 1];
  if (target && state.rendition) await state.rendition.display(target.href);
}

export async function epubChapterPrev() {
  const current = state.epubCurrentChapter;
  const target = state.epubChapters[current - 1];
  if (target && state.rendition) await state.rendition.display(target.href);
}

export async function setEPUBMode(mode) {
  if (!['scroll', 'paginated'].includes(mode) || mode === state.epubMode || !state.book) return;
  const location = state.epubLocation;
  const url = state.epubUrl;
  const filename = state.activeFile;
  const requestId = state.requestId;
  state.epubMode = mode;
  state.epubRenderToken += 1;
  state.rendition?.destroy();
  state.book?.destroy();
  state.rendition = null;
  state.book = null;
  $('#epub-container').replaceChildren();
  updateEPUBModeControl();
  await renderEPUB(url, filename, requestId, mode, location);
}

export function resetEPUBState() {
  state.epubRenderToken += 1;
  state.epubLocation = null;
  state.epubCurrentPage = 0;
  state.epubTotalPages = 0;
  state.epubLocationsReady = false;
  state.epubCurrentChapter = -1;
  state.epubChapters = [];
  state.epubStatus = 'idle';
  state.epubUrl = null;
  updateEPUBModeControl();
  setEPUBPage(0, 0);
  updateEPUBChapterControls();
  $('#epub-status').classList.remove('is-error');
  $('#epub-status').classList.add('is-hidden');
}

export function toggleTOC(force) {
  const panel = $('#epub-toc-panel');
  const show = typeof force === 'boolean' ? force : !panel.classList.contains('show');
  panel.classList.toggle('show', show);
  panel.setAttribute('aria-hidden', String(!show));
}
