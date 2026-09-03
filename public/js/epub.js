// EPUB 阅读器主入口（编排层）
// 本文件只负责：
//   1) 暴露给 app.js / 其他模块的公共 API（renderEPUB / epubNext / epubPrev / … / resetEPUBState / toggleTOC）
//   2) 编排电子书生命周期：status 面板 → ePub() book → rendition → hooks → relocated → TOC → locations
//   3) 全局小工具（setEPUBStatus / setEPUBPage / cfiValue / safelyDestroy / waitForStage）
//
// 所有具体业务实现均拆分到：
//   epub-styles.js            CSS 规则 + 注入 + 安装导航
//   epub-navigation.js        iframe 内/宿主层翻页交互 + 效果选择器 UI
//   epub-progress.js          进度条拖动 + relocated 更新 state / 存储
//   epub-toc.js               目录加载与渲染
//   epub-locations-cache.js   locations 生成缓存
//
// 与 app.js 的公共 API 保持不变（app.js 的 import 列表不用改）。
import { state } from './state.js';
import { $ } from './utils.js';
import { updateBookProgress, markBookOpened, getBookReadingProgress } from './reading.js';
import { t } from './i18n.js';
import {
  beginPageDrag, cancelPageDrag, endPageDrag,
  isPageTurning, isPageTurnBypassed, turnPage, updatePageDrag, warmupPageTurnCapture,
  acquireNavLock, releaseNavLock,
} from './page-turn.js';
import { installEPUBStyles } from './epub-styles.js?v=16';
import { setupPageTurnSelector } from './epub-navigation.js?v=16';
import {
  cfiValue,
  clearEPUBProgressTracking,
  setEPUBProgress,
  setupEPUBProgressBar,
  updateSavedEPUBProgress,
  updateEPUBLocation,
  updateEPUBChapterControls,
} from './epub-progress.js?v=16';
import { loadEPUBTOC } from './epub-toc.js?v=16';
import { generateEPUBLocations } from './epub-locations-cache.js?v=16';

// ═══════════════════════════════════════════════════════════════════
// 全局小工具
// ═══════════════════════════════════════════════════════════════════

// EPUB 阅读器状态栏：idle / loading / ready / error
export function setEPUBStatus(status, title, detail = '') {
  state.epubStatus = status;
  const box = $('#epub-status');
  const titleEl = $('#epub-status-title');
  const detailEl = $('#epub-status-detail');
  if (titleEl) titleEl.textContent = title || '';
  if (detailEl) detailEl.textContent = detail || '';
  if (!box) return;
  box.classList.remove('is-loading', 'is-error', 'is-ready', 'is-hidden');
  if (status === 'loading') box.classList.add('is-loading');
  else if (status === 'error') box.classList.add('is-error');
  else if (status === 'ready') box.classList.add('is-ready', 'is-hidden');
  else box.classList.add('is-hidden');
}

// 状态/通知：当前页 / 总页数（不直接改 DOM 展示，UI 已统一用进度条百分比）
export function setEPUBPage(current, total) {
  state.epubCurrentPage = Number(current) || 0;
  state.epubTotalPages = Number(total) || 0;
}

// 复用 utils.safelyDestroy 的语义，避免在本文件引入 utils 除 $ 外的循环依赖
export function safelyDestroy(resource, label) {
  if (!resource) return;
  const fns = [
    () => typeof resource.destroy === 'function' && resource.destroy(),
    () => typeof resource.close === 'function' && resource.close(),
    () => typeof resource.dispose === 'function' && resource.dispose(),
  ];
  for (const fn of fns) {
    try { fn(); return; } catch (error) {
      console.warn(`${label || '资源'} 清理失败:`, error);
    }
  }
}

// 渲染流程阶段追踪器：带超时的 Promise 包装
// 配合 reader.showStage / reader.clearStage 显示到右上角状态面板（面板若不存在则静默）。
async function waitForStage(promise, stageKey, timeout = 15000) {
  const reader = window.reader;
  if (reader?.showStage) reader.showStage(stageKey);
  let timeoutId = 0;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timeoutId = window.setTimeout(
          () => reject(new Error(`Timeout: ${stageKey}`)),
          timeout,
        );
      }),
    ]);
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
    if (reader?.clearStage) reader.clearStage(stageKey);
  }
}

// ═══════════════════════════════════════════════════════════════════
// 编排：打开 EPUB → book → rendition → TOC + locations
// ═══════════════════════════════════════════════════════════════════

export async function renderEPUB(url, filename, requestId, restoreLocation = null, fileObject = null) {
  const container = $('#epub-container');
  clearEPUBProgressTracking();
  const resumeLocation = restoreLocation?.kind === 'epub-cfi'
    ? cfiValue(restoreLocation.value)
    : cfiValue(restoreLocation);
  state.epubUrl = url;
  const mode = 'paginated';
  $('#epub-reader').dataset.mode = mode;
  $('#epub-reader').classList.remove('mode-scroll');
  $('#epub-reader').classList.add('mode-paginated');
  state.epubLocation = null;
  state.epubCurrentPage = 0;
  state.epubTotalPages = 0;
  state.epubProgressOverride = null;
  state.epubLocationsReady = false;
  state.epubChapters = [];
  state.epubRenderToken += 1;
  const renderToken = state.epubRenderToken;
  setEPUBPage(0, 0);

  const savedProgress = getBookReadingProgress(filename);
  setEPUBProgress(savedProgress);

  setEPUBStatus('loading', t('reader.loadingEpub'), t('reader.preparingContent'));
  container.replaceChildren();

  try {
    await waitForLibrary('JSZip', () => typeof window.JSZip === 'function');
    await waitForLibrary('ePub', () => typeof window.ePub === 'function');
    if (requestId !== state.requestId || renderToken !== state.epubRenderToken) return;

    let epubSource = url;
    if (fileObject instanceof File || fileObject instanceof Blob) {
      setEPUBStatus('loading', t('reader.loadingEpub'), t('reader.readingFileContent'));
      epubSource = await fileObject.arrayBuffer();
      if (requestId !== state.requestId || renderToken !== state.epubRenderToken) return;
    }

    const book = window.ePub(epubSource);
    state.book = book;
    const rendition = book.renderTo(container, {
      width: '100%',
      height: '100%',
      flow: 'paginated',
      manager: 'default',
      spread: 'auto',
      allowScriptedContent: false,
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
      setEPUBStatus('error', t('reader.epubRenderFailedTitle'), error?.message || t('reader.chapterUnavailable'));
    });

    await waitForStage(book.ready, 'reader.stageReadEpub');
    if (requestId !== state.requestId || renderToken !== state.epubRenderToken) return;
    const title = book.package?.metadata?.title || book.metadata?.title || filename;
    $('#epub-title').textContent = title;

    const dlLink = $('#epub-download');
    if (dlLink) {
      dlLink.href = url;
      dlLink.download = filename.split('/').pop().replace(/^__local__\//, '');
    }

    await waitForStage(rendition.display(resumeLocation || undefined), 'reader.stageRenderEpub');
    if (requestId !== state.requestId || renderToken !== state.epubRenderToken) return;
    markBookOpened(filename);
    setEPUBStatus('ready');
    setupEPUBProgressBar();
    setupPageTurnSelector();

    // Safari/WebKit 预跑一次截图可行性 probe（EPUB 基本是 blob iframe，1ms 内短路到不可行），
    // 之后 turnPage/beginPageDrag 就直接走永久 bypass，避免用户第一次按键/滑动才被 300ms probe 挡住。
    // requestIdleCallback 不阻塞首帧响应。
    const warmupTarget = container;
    if ('requestIdleCallback' in window) window.requestIdleCallback(() => warmupPageTurnCapture(warmupTarget), { timeout: 600 });
    else window.setTimeout(() => warmupPageTurnCapture(warmupTarget), 200);

    void loadEPUBTOC(book, requestId, renderToken).catch((error) => {
      console.warn('EPUB 目录加载失败:', error);
    });
    void generateEPUBLocations(book, requestId, renderToken);
  } catch (error) {
    if (requestId !== state.requestId || renderToken !== state.epubRenderToken) return;
    console.error('EPUB 渲染失败:', error);
    setEPUBStatus('error', t('reader.epubLoadFailedTitle'), error.message || t('reader.fileParseFailed'));
  }
}

// ═══════════════════════════════════════════════════════════════════
// 导出：翻页 / 章节跳转 / 重置 / 目录抽屉
// ═══════════════════════════════════════════════════════════════════

export async function jumpToEPUBPage(_value) {
  // 遗留：仅用于兼容 app.js 的 import；功能由进度条拖动代替
  console.warn('jumpToEPUBPage 已废弃，请使用进度条交互');
}

export async function epubNext() {
  if (!state.rendition) return;
  if (state.epubMode === 'paginated') {
    const container = $('#epub-container');
    // Safari 永久 bypass 或 短暂 bypass：跳过 turnPage 的 Promise+sheet 构建
    // （否则即便内部 fallback 路径 0 等待，仍会付出：创建 div+加类+removeSheet+WeakMap add/delete
    //   + async/await 微任务调度 的开销 → 主观感受是「按键有延迟」）
    if (isPageTurnBypassed(container)) {
      // bypass 模式下 turnPage() 不会被调用 → 得自己拿 activeContainers 这把互斥锁：
      //  1) 防止连按把多个 rendition.next() 塞成队列（WebKit 单线程+relocated 回调重，队列会雪崩）
      //  2) 让 isPageTurning() 返回 true，pointer/touch handler 不会在翻页半途中又起一个 drag
      if (!acquireNavLock(container)) return;
      try {
        await state.rendition.next();
      } catch (err) {
        console.warn('EPUB 翻下一页失败:', err);
      } finally {
        releaseNavLock(container);
      }
      return;
    }
    await new Promise((resolve, reject) => {
      if (!turnPage(container, 1, () => state.rendition.next().then(resolve, reject))) resolve();
    });
    return;
  }
  const container = $('#epub-container');
  container.scrollBy({ top: Math.max(container.clientHeight * 0.86, 240), behavior: 'smooth' });
}

export async function epubPrev() {
  if (!state.rendition) return;
  if (state.epubMode === 'paginated') {
    const container = $('#epub-container');
    if (isPageTurnBypassed(container)) {
      if (!acquireNavLock(container)) return;
      try {
        await state.rendition.prev();
      } catch (err) {
        console.warn('EPUB 翻上一页失败:', err);
      } finally {
        releaseNavLock(container);
      }
      return;
    }
    await new Promise((resolve, reject) => {
      if (!turnPage(container, -1, () => state.rendition.prev().then(resolve, reject))) resolve();
    });
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
  state.epubProgressOverride = null;
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
  const btn = $('#epub-toc');
  btn?.setAttribute('aria-expanded', String(show));
  btn?.setAttribute('aria-label', show ? '关闭目录' : '打开目录');
  if (show) {
    const activeIndex = typeof state.epubCurrentChapter === 'number'
      && state.epubCurrentChapter >= 0 ? state.epubCurrentChapter : -1;
    if (activeIndex >= 0) {
      const item = sidebar.querySelectorAll('.pdf-outline-item')[activeIndex];
      item?.scrollIntoView({ block: 'nearest' });
    }
  }
}

// 防止未使用变量警告（页面拖拽 API 保留给 epub-navigation 内调用，这里不直接使用）
void beginPageDrag;
void cancelPageDrag;
void endPageDrag;
void isPageTurning;
void updatePageDrag;
void updateSavedEPUBProgress;
// 兼容旧代码里对 window.waitForLibrary 的调用（app.js/其他入口可能没提供）
if (typeof window.waitForLibrary !== 'function') {
  window.waitForLibrary = async function waitForLibrary(name, ready, maxWait = 8000) {
    const started = Date.now();
    while (Date.now() - started < maxWait) {
      if (ready()) return;
      await new Promise((r) => window.setTimeout(r, 50));
    }
    throw new Error(`Library ${name} 加载超时`);
  };
}
