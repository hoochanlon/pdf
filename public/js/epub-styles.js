// EPUB 样式注入模块
// 职责：把排版规则（字体、颜色、滚动/分页差异）加到 epub.js 创建的 iframe contents 中，
// 并同步安装后续导航交互（由 epub-navigation 提供）。
import { state } from './state.js';
import { installEPUBNavigation } from './epub-navigation.js?v=16';

// ── 排版基础：两种阅读模式共享，只管字体与配色，不干预布局。──────────
export const CONTENT_TYPOGRAPHY = {
  'font-family': '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif !important',
  'font-size': 'clamp(16px, 1.15vw, 19px) !important',
  'line-height': '1.85 !important',
  color: '#263247 !important',
  background: '#fffdf9 !important',
};

export const SHARED_CONTENT_RULES = {
  'img, svg, video': { 'max-width': '100% !important', height: 'auto !important' },
  'p, li, blockquote': { 'overflow-wrap': 'break-word !important' },
  'h1, h2, h3, h4': { 'line-height': '1.35 !important', 'margin-top': '1.6em !important' },
};

// 连续滚动模式：长文档流式排版，由我们接管尺寸。
export const SCROLL_CONTENT_RULES = {
  html: {
    height: 'auto !important',
    'min-height': '100% !important',
    overflow: 'visible !important',
  },
  body: {
    ...CONTENT_TYPOGRAPHY,
    padding: 'clamp(24px, 5vw, 72px) clamp(18px, 7vw, 96px) !important',
    margin: '0 auto !important',
    'max-width': '820px !important',
    overflow: 'visible !important',
    'user-select': 'text !important',
    '-webkit-user-select': 'text !important',
    '-webkit-touch-callout': 'default !important',
  },
  ...SHARED_CONTENT_RULES,
};

// 分页模式：页面切分完全交给 epub.js 的列排版，任何尺寸/溢出覆盖都会导致列错位。
export const PAGINATED_CONTENT_RULES = {
  body: {
    ...CONTENT_TYPOGRAPHY,
    'touch-action': 'none !important',
    'user-select': 'none !important',
    '-webkit-user-select': 'none !important',
    '-webkit-touch-callout': 'none !important',
  },
  ...SHARED_CONTENT_RULES,
};

/**
 * 由 epub.js rendition.hooks.content.register 触发，每个新章节 iframe 注入一次。
 * @param {{ addStylesheetRules: (rules: object) => void, window: Window, document: Document, frameElement: HTMLIFrameElement }} contents
 */
export function installEPUBStyles(contents) {
  const paginated = state.epubMode === 'paginated';
  contents.addStylesheetRules(paginated ? PAGINATED_CONTENT_RULES : SCROLL_CONTENT_RULES);

  try {
    const frameWindow = contents.window;
    const frameDocument = contents.document;
    const frame = frameWindow.frameElement;
    if (!frame) return;
    installEPUBNavigation(frameDocument, frame, frameWindow);
    frame.style.touchAction = paginated ? 'none' : '';
    frame.style.userSelect = paginated ? 'none' : '';
    frame.style.webkitUserSelect = paginated ? 'none' : '';
    if (paginated) return;

    // 仅滚动模式：把 iframe 高度撑到内容总高度；分页模式保持 100% 视口。
    const syncFrameHeight = () => {
      const root = frameDocument.documentElement;
      const body = frameDocument.body;
      const height = Math.max(
        root?.scrollHeight || 0,
        root?.offsetHeight || 0,
        body?.offsetHeight || 0,
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
