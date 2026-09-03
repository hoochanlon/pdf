// EPUB 样式注入模块
// 职责：把排版规则（字体、颜色、滚动/分页差异）加到 epub.js 创建的 iframe contents 中，
// 并同步安装后续导航交互（由 epub-navigation 提供）。
import { state } from './state.js';
import { installEPUBNavigation } from './epub-navigation.js?v=16';

// ── WebKit 内核检测（与 epub-navigation.js / page-turn.js 保持一致）────────
// 在样式层同样需要检测，用来决定是否注入"禁用翻页过渡"的 CSS：
//   Safari 的合成层调度在 iframe 失焦（或被降优先级）时会把列过渡掐成落地，
//   与其随机有/随机无动画，不如 WebKit 统一禁用 → 一致的即时翻页体验。
function isWebKitLike(navigatorRef = navigator) {
  const ua = (navigatorRef.userAgent || '');
  const platform = String(navigatorRef.platform || '');
  const isIOSLike = /iPad|iPhone|iPod/i.test(platform)
    || (platform === 'MacIntel' && typeof navigatorRef.maxTouchPoints === 'number' && navigatorRef.maxTouchPoints > 1);
  const isDesktopSafari = /^((?!chrome|crios|android|edg|opr|fxios|fxiOS).)*safari/i.test(ua)
    || (((navigatorRef.vendor || '')).includes('Apple') && !/chrome|crios|edg|opr|fxios|fxiOS/i.test(ua));
  return isIOSLike || isDesktopSafari;
}

// ═══════════════════════════════════════════════════════════════════
// Safari / iOS WebKit 专属：强制关闭翻页相关的过渡与动画
// 作用域：html（含 epub.js 渲染层 wrapper）、body、及其所有后代。
// 不影响字体/颜色等排版属性，只针对时间性动画/过渡下手。
// ═══════════════════════════════════════════════════════════════════
const WEBKIT_NO_ANIMATION_RULES = {
  html: {
    scrollBehavior: 'auto !important',
  },
  body: {
    scrollBehavior: 'auto !important',
  },
  'html, body, body > *, body > * > *': {
    transition: 'none !important',
    animation: 'none !important',
  },
  // epub.js default manager 用 transform: translateX() 推动列切换。
  // 把 html / documentElement 这一层的过渡和动画强制关掉，
  // 让 transform 直接跳到目标值。
  'html, :root': {
    transition: 'none !important',
    animation: 'none !important',
    transform: 'none',
  },
};

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
  const baseRules = paginated ? PAGINATED_CONTENT_RULES : SCROLL_CONTENT_RULES;

  // Safari / iOS WebKit + 分页模式：叠加"全关过渡"规则，保证即时翻页，不随时间随机失效。
  const webkitLike = (() => {
    try { return isWebKitLike(contents.window?.navigator || navigator); }
    catch (_) { return false; }
  })();
  const effectiveRules = (paginated && webkitLike)
    ? mergeRulesDeep(baseRules, WEBKIT_NO_ANIMATION_RULES)
    : baseRules;
  contents.addStylesheetRules(effectiveRules);

  try {
    const frameWindow = contents.window;
    const frameDocument = contents.document;
    const frame = frameWindow.frameElement;
    if (!frame) return;
    if (paginated && webkitLike) {
      frame.closest('.epub-container')?.classList.add('webkit-no-page-animation');
    }
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

/**
 * 浅+深合并两份 CSS 规则对象：
 *   - 键相同 → 把后者的属性覆盖到前者（保留前者独有的属性）
 *   - 键不同 → 并集
 * 用于把 WEBKIT_NO_ANIMATION_RULES 的"关过渡"属性插到 baseRules 的已有选择器上，
 * 同时保留 baseRules 的排版/颜色属性。
 */
function mergeRulesDeep(base, extra) {
  const out = { ...base };
  for (const selector of Object.keys(extra)) {
    out[selector] = out[selector] ? { ...out[selector], ...extra[selector] } : { ...extra[selector] };
  }
  return out;
}
