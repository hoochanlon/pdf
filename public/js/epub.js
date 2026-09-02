// EPUB 渲染模块
import { state } from './state.js';
import { $ } from './utils.js';
import { updateBookProgress, markBookOpened, getBookReadingProgress } from './reading.js';

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
  // 保留函数避免其他地方的调用报错，但不再更新 UI
  state.epubCurrentPage = current;
  state.epubTotalPages = total;
}

function cfiValue(cfi) {
  return typeof cfi === 'string' ? cfi : cfi?.toString?.() || '';
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

// 排版基础：两种阅读模式共享，只管字体与配色，不干预布局。
const CONTENT_TYPOGRAPHY = {
  'font-family': '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif !important',
  'font-size': 'clamp(16px, 1.15vw, 19px) !important',
  'line-height': '1.85 !important',
  color: '#263247 !important',
  background: '#fffdf9 !important'
};

const SHARED_CONTENT_RULES = {
  'img, svg, video': { 'max-width': '100% !important', height: 'auto !important' },
  'p, li, blockquote': { 'overflow-wrap': 'break-word !important' },
  'h1, h2, h3, h4': { 'line-height': '1.35 !important', 'margin-top': '1.6em !important' }
};

// 连续滚动模式：长文档流式排版，由我们接管尺寸。
const SCROLL_CONTENT_RULES = {
  html: {
    height: 'auto !important',
    'min-height': '100% !important',
    overflow: 'visible !important'
  },
  body: {
    ...CONTENT_TYPOGRAPHY,
    padding: 'clamp(24px, 5vw, 72px) clamp(18px, 7vw, 96px) !important',
    margin: '0 auto !important',
    'max-width': '820px !important',
    overflow: 'visible !important',
    'user-select': 'text !important',
    '-webkit-user-select': 'text !important',
    '-webkit-touch-callout': 'default !important'
  },
  ...SHARED_CONTENT_RULES
};

// 分页模式：页面切分完全交给 epub.js 的列排版，任何尺寸/溢出覆盖都会导致列错位。
const PAGINATED_CONTENT_RULES = {
  body: {
    ...CONTENT_TYPOGRAPHY,
    'touch-action': 'none !important',
    'user-select': 'none !important',
    '-webkit-user-select': 'none !important',
    '-webkit-touch-callout': 'none !important'
  },
  ...SHARED_CONTENT_RULES
};

function installEPUBStyles(contents) {
  const paginated = state.epubMode === 'paginated';
  contents.addStylesheetRules(paginated ? PAGINATED_CONTENT_RULES : SCROLL_CONTENT_RULES);

  try {
    const frameWindow = contents.window;
    const frameDocument = contents.document;
    const frame = frameWindow.frameElement;
    if (!frame) return;
    installEPUBNavigation(frameDocument);
    frame.style.touchAction = paginated ? 'none' : '';
    frame.style.userSelect = paginated ? 'none' : '';
    frame.style.webkitUserSelect = paginated ? 'none' : '';
    if (paginated) return;

    // 仅滚动模式需要把 iframe 拉到内容总高度；分页模式下必须保持 100% 视口。
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

let lastEPUBNavAt = 0;

// 统一翻页节流：键盘、点击分区、滑动共用一个时间窗口，避免一次手势翻多页。
function requestEPUBNav(direction) {
  const now = Date.now();
  if (now - lastEPUBNavAt < 320) return;
  lastEPUBNavAt = now;
  void (direction < 0 ? epubPrev() : epubNext());
}

// 豆瓣式交互：分页模式下，iframe 内支持左右键、点击左右分区、横滑三种翻页方式。
function installEPUBNavigation(frameDocument) {
  const frameWindow = frameDocument.defaultView;
  let gesture = null;
  let suppressClickUntil = 0;

  const isInteractiveTarget = (target) => target?.nodeType === 1
    && Boolean(target.closest('a, button, input, select, textarea'));
  const isHorizontalSwipe = (distanceX, distanceY) => (
    Math.abs(distanceX) >= 56 && Math.abs(distanceX) > Math.abs(distanceY) * 1.25
  );
  const closeTOCBeforeNavigation = () => {
    const sidebar = $('#epub-sidebar');
    if (!sidebar.classList.contains('show')) return false;
    toggleTOC(false);
    return true;
  };

  // 点击分区：左 1/4 上一页，右 3/4 下一页（主流阅读器的默认习惯）。
  const isNavClick = (event) => state.epubMode === 'paginated'
    && !isInteractiveTarget(event.target)
    && Date.now() >= suppressClickUntil;
  const navigateByClickX = (clientX) => {
    if (closeTOCBeforeNavigation()) return;
    const edge = Math.min(frameWindow.innerWidth * 0.25, 140);
    if (clientX <= edge) requestEPUBNav(-1);
    else if (clientX >= frameWindow.innerWidth - edge) requestEPUBNav(1);
  };

  const navigateBySwipe = (distanceX, distanceY, event, target) => {
    if (!isHorizontalSwipe(distanceX, distanceY) || isInteractiveTarget(target)) return;
    if (closeTOCBeforeNavigation()) return;
    suppressClickUntil = Date.now() + 360;
    if (event.cancelable) event.preventDefault();
    // 物理书翻页习惯：从左往右拖 = 上一页，从右往左拖 = 下一页
    requestEPUBNav(distanceX < 0 ? -1 : 1);
  };
  const suppressDraggedClick = (event) => {
    if (Date.now() >= suppressClickUntil) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClickUntil = 0;
  };

  // iframe 内键盘事件不会冒泡到主文档，需要单独接管。
  frameDocument.addEventListener('keydown', (event) => {
    if (state.epubMode !== 'paginated' || event.target?.closest?.('input, textarea, select')) return;
    const navKeys = { ArrowLeft: -1, ArrowUp: -1, PageUp: -1, ArrowRight: 1, ArrowDown: 1, PageDown: 1, ' ': 1 };
    const direction = navKeys[event.key];
    if (!direction) return;
    event.preventDefault();
    requestEPUBNav(direction);
  });

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
        target: event.target,
        dragged: false
      };
      event.target?.setPointerCapture?.(event.pointerId);
    }, { passive: true });
    frameDocument.addEventListener('pointermove', (event) => {
      if (!gesture || event.pointerId !== gesture.id) return;
      // 桌面端鼠标拖动必须立即阻止默认行为（文本选择），不能等到达阈值才 preventDefault。
      if (event.cancelable) event.preventDefault();
      const distanceX = event.clientX - gesture.x;
      const distanceY = event.clientY - gesture.y;
      if (isHorizontalSwipe(distanceX, distanceY)) gesture.dragged = true;
    }, { passive: false });
    frameDocument.addEventListener('pointerup', (event) => {
      if (!gesture || event.pointerId !== gesture.id) return;
      const current = gesture;
      reset();
      const distanceX = event.clientX - current.x;
      const distanceY = event.clientY - current.y;
      if (isHorizontalSwipe(distanceX, distanceY)) {
        navigateBySwipe(distanceX, distanceY, event, current.target);
        return;
      }
      // 未拖动的点按（含触屏轻点）按分区翻页。
      if (!current.dragged && isNavClick(event)) navigateByClickX(event.clientX);
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
      const distanceX = touch.clientX - current.x;
      const distanceY = touch.clientY - current.y;
      if (isHorizontalSwipe(distanceX, distanceY)) {
        navigateBySwipe(distanceX, distanceY, event, current.target);
        return;
      }
      if (isNavClick(event)) navigateByClickX(touch.clientX);
    }, { passive: false });
    frameDocument.addEventListener('touchcancel', resetTouch, { passive: true });
  }

  frameDocument.addEventListener('click', (event) => {
    if (!isInteractiveTarget(event.target)) toggleTOC(false);
  });
  frameDocument.addEventListener('click', suppressDraggedClick, true);

  // 触控板横向滑动：wheel 事件的 deltaX 累积超过阈值时翻页（两指/三指滑动）。
  let wheelDeltaX = 0;
  let wheelResetTimer = null;
  frameDocument.addEventListener('wheel', (event) => {
    if (state.epubMode !== 'paginated') return;
    if (closeTOCBeforeNavigation()) {
      wheelDeltaX = 0;
      return;
    }
    const { deltaX, deltaY } = event;
    // 只处理明显的横向滚动：横向分量 > 垂直分量的 1.2 倍（触控板横滑）
    if (Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return;
    
    clearTimeout(wheelResetTimer);
    wheelDeltaX += deltaX;
    
    // 累积横向增量超过 40 触发翻页（物理书翻页习惯：向左滑 = 下一页，向右滑 = 上一页）
    const threshold = 40;
    if (Math.abs(wheelDeltaX) >= threshold) {
      if (event.cancelable) event.preventDefault();
      requestEPUBNav(wheelDeltaX > 0 ? 1 : -1);
      wheelDeltaX = 0;
    } else {
      // 300ms 内没有新的 wheel 事件，重置累积值（更宽容的滑动停顿窗口）
      wheelResetTimer = setTimeout(() => { wheelDeltaX = 0; }, 300);
    }
  }, { passive: false });
}

function clearEPUBProgressTracking() {
  const container = $('#epub-container');
  if (state.epubScrollHandler) {
    container.removeEventListener('scroll', state.epubScrollHandler);
    state.epubScrollHandler = null;
  }
  if (state.epubScrollFrame) cancelAnimationFrame(state.epubScrollFrame);
  state.epubScrollFrame = 0;
}

function setEPUBProgress(progress) {
  const safeProgress = Math.max(0, Math.min(1, Number(progress) || 0));
  const percent = Math.round(safeProgress * 100);
  $('#epub-progress-bar').style.width = `${safeProgress * 100}%`;
  $('#epub-progress-percent').textContent = `${percent}%`;
  const valueDisplay = $('#epub-progress-value');
  if (valueDisplay) valueDisplay.textContent = `${percent}%`;
}

function setupEPUBProgressBar() {
  const wrap = $('#epub-progress-wrap');
  const bar = $('#epub-progress-bar');
  if (!wrap || !bar) return;

  let isDragging = false;

  function getProgressFromEvent(event) {
    const rect = wrap.getBoundingClientRect();
    const x = (event.type.startsWith('touch') ? event.touches[0].clientX : event.clientX) - rect.left;
    return Math.max(0, Math.min(1, x / rect.width));
  }

  function handleProgressChange(fraction) {
    if (!state.rendition || !state.book?.locations) return;
    const location = state.book.locations.cfiFromPercentage(fraction);
    void state.rendition.display(location);
  }

  function onStart(event) {
    if (event.button !== undefined && event.button !== 0) return;
    isDragging = true;
    wrap.classList.add('dragging');
    const fraction = getProgressFromEvent(event);
    setEPUBProgress(fraction);
    handleProgressChange(fraction);
    event.preventDefault();
  }

  function onMove(event) {
    if (!isDragging) return;
    const fraction = getProgressFromEvent(event);
    setEPUBProgress(fraction);
    handleProgressChange(fraction);
    event.preventDefault();
  }

  function onEnd() {
    if (!isDragging) return;
    isDragging = false;
    wrap.classList.remove('dragging');
  }

  wrap.addEventListener('mousedown', onStart);
  wrap.addEventListener('touchstart', onStart, { passive: false });
  document.addEventListener('mousemove', onMove);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('mouseup', onEnd);
  document.addEventListener('touchend', onEnd);
}

function updateSavedEPUBProgress(location, progress) {
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
    cfi ? { kind: 'epub-cfi', value: cfi } : undefined
  );
}

export async function renderEPUB(url, filename, requestId, restoreLocation = null) {
  const container = $('#epub-container');
  clearEPUBProgressTracking();
  const resumeLocation = restoreLocation?.kind === 'epub-cfi'
    ? cfiValue(restoreLocation.value)
    : cfiValue(restoreLocation);
  state.epubUrl = url;
  const mode = 'paginated'; // 固定分页模式
  $('#epub-reader').dataset.mode = mode;
  $('#epub-reader').classList.remove('mode-scroll');
  $('#epub-reader').classList.add('mode-paginated');
  state.epubLocation = null;
  state.epubCurrentPage = 0;
  state.epubTotalPages = 0;
  state.epubLocationsReady = false;
  state.epubChapters = [];
  state.epubRenderToken += 1;
  const renderToken = state.epubRenderToken;
  setEPUBPage(0, 0);
  
  // 立即显示保存的进度（如果有）
  const savedProgress = getBookReadingProgress(filename);
  setEPUBProgress(savedProgress);
  
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
      flow: 'paginated',
      manager: 'default',
      spread: 'auto',
      allowScriptedContent: false
    });
    state.rendition = rendition;
    
    rendition.hooks.content.register(installEPUBStyles);
    const isCurrentRendition = () => (
      requestId === state.requestId
      && renderToken === state.epubRenderToken
      && state.rendition === rendition
      && state.book === book
    );
    rendition.on('relocated', (location) => {
      if (isCurrentRendition()) updateEPUBLocation(location);
    });
    rendition.on('displayError', (error) => {
      if (!isCurrentRendition()) return;
      console.error('EPUB 页面渲染失败:', error);
      setEPUBStatus('error', 'EPUB 页面渲染失败', error?.message || '章节内容无法显示');
    });

    await waitForStage(book.ready, '读取 EPUB 文件');
    if (requestId !== state.requestId || renderToken !== state.epubRenderToken) return;
    const title = book.package?.metadata?.title || book.metadata?.title || filename;
    $('#epub-title').textContent = title;

    // 设置下载链接
    const dlLink = $('#epub-download');
    if (dlLink) {
      dlLink.href = url;
      dlLink.download = filename.split('/').pop();
    }

    await waitForStage(rendition.display(resumeLocation || undefined), '渲染 EPUB 内容');
    if (requestId !== state.requestId || renderToken !== state.epubRenderToken) return;
    markBookOpened(filename);
    setEPUBStatus('ready');
    setupEPUBProgressBar();
    
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

function getEPUBSpineIndex(book, href, fallback) {
  const hrefWithoutFragment = href?.split('#', 1)[0] || href;
  return book.spine.get(href)?.index
    ?? book.spine.get(hrefWithoutFragment)?.index
    ?? fallback;
}

async function loadEPUBTOC(book, requestId, renderToken) {
  const list = $('#epub-toc-list');
  list.replaceChildren();
  const navigation = await waitForStage(book.loaded.navigation, '读取 EPUB 目录', 10000);
  if (requestId !== state.requestId || renderToken !== state.epubRenderToken) return;
  const items = navigation?.toc || [];
  const chapters = [];
  const isCurrentTOC = () => (
    requestId === state.requestId
    && renderToken === state.epubRenderToken
    && state.book === book
    && state.rendition
  );
  if (!items.length) {
    state.epubChapters = [];
    const empty = document.createElement('li');
    empty.className = 'pdf-outline-empty';
    empty.textContent = '此 EPUB 没有目录';
    list.appendChild(empty);
    updateEPUBChapterControls();
    return;
  }
  const appendItems = (entries, parent, level = 0) => entries.forEach((entry) => {
    const chapter = {
      href: entry.href,
      label: entry.label?.trim() || '未命名目录项',
      level,
      spineIndex: getEPUBSpineIndex(book, entry.href, chapters.length)
    };
    chapters.push(chapter);
    const item = document.createElement('li');
    const button = document.createElement('button');
    item.className = 'pdf-outline-item';
    button.type = 'button';
    button.textContent = chapter.label;
    button.style.paddingLeft = `${12 + level * 14}px`;
    button.addEventListener('click', () => {
      if (!isCurrentTOC()) return;
      const rendition = state.rendition;
      void rendition.display(chapter.href).catch((error) => {
        if (isCurrentTOC()) console.warn('EPUB 目录跳转失败:', error);
      });
      toggleTOC(false);
    });
    item.appendChild(button);
    parent.appendChild(item);
    if (entry.subitems?.length) appendItems(entry.subitems, parent, level + 1);
  });
  appendItems(items, list);
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

  let progress = start.percentage;
  if (typeof progress !== 'number' && state.epubLocationsReady && cfi) {
    progress = state.book.locations.percentageFromCfi(cfi);
  }
  const reachedEnd = location.atEnd === true || location.end?.atEnd === true;
  if (typeof progress === 'number') {
    progress = reachedEnd ? 1 : Math.max(0, Math.min(1, progress));
    updateSavedEPUBProgress(location, progress);
  }

  if (state.epubLocationsReady && cfi) {
    const locationIndex = state.book.locations.locationFromCfi(cfi);
    state.epubCurrentPage = Math.max(1, Math.min(state.epubTotalPages, locationIndex + 1));
  }
  setEPUBPage(state.epubCurrentPage, state.epubTotalPages);
  updateEPUBChapterControls();
}

function updateEPUBChapterControls() {
  // 章节按钮已移除，保留函数避免其他地方的调用报错
}

export async function jumpToEPUBPage(value) {
  // 保留函数避免 app.js 调用报错，但功能已废弃
  console.warn('jumpToEPUBPage 已废弃，请使用进度条交互');
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

export function resetEPUBState() {
  clearEPUBProgressTracking();
  state.epubRenderToken += 1;
  state.epubLocation = null;
  state.epubCurrentPage = 0;
  state.epubTotalPages = 0;
  state.epubLocationsReady = false;
  state.epubCurrentChapter = -1;
  state.epubChapters = [];
  state.epubStatus = 'idle';
  state.epubUrl = null;
  setEPUBPage(0, 0);
  setEPUBProgress(0);
  updateEPUBChapterControls();
  toggleTOC(false);
  $('#epub-status').classList.remove('is-error');
  $('#epub-status').classList.add('is-hidden');
  const dlLink = $('#epub-download');
  if (dlLink) { dlLink.removeAttribute('href'); dlLink.removeAttribute('download'); }
}

export function toggleTOC(force) {
  const sidebar = $('#epub-sidebar');
  const show = typeof force === 'boolean' ? force : !sidebar.classList.contains('show');
  sidebar.classList.toggle('show', show);
  sidebar.setAttribute('aria-hidden', String(!show));
  $('#epub-toc').setAttribute('aria-expanded', String(show));
}
