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

  // 点击分区：左 1/4 上一页，右 3/4 下一页（主流阅读器的默认习惯）。
  const isNavClick = (event) => state.epubMode === 'paginated'
    && !isInteractiveTarget(event.target)
    && Date.now() >= suppressClickUntil;
  const navigateByClickX = (clientX) => {
    const edge = Math.min(frameWindow.innerWidth * 0.25, 140);
    if (clientX <= edge) requestEPUBNav(-1);
    else if (clientX >= frameWindow.innerWidth - edge) requestEPUBNav(1);
  };

  const navigateBySwipe = (distanceX, distanceY, event, target) => {
    if (!isHorizontalSwipe(distanceX, distanceY) || isInteractiveTarget(target)) return;
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
    const navKeys = { ArrowLeft: -1, PageUp: -1, ArrowRight: 1, PageDown: 1, ' ': 1 };
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

  frameDocument.addEventListener('click', suppressDraggedClick, true);

  // 触控板横向滑动：wheel 事件的 deltaX 累积超过阈值时翻页（两指/三指滑动）。
  let wheelDeltaX = 0;
  let wheelResetTimer = null;
  frameDocument.addEventListener('wheel', (event) => {
    if (state.epubMode !== 'paginated') return;
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
