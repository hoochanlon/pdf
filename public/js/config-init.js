// 配置初始化模块
import { config } from '../config.js';
import { $ } from './utils.js';
import { state } from './state.js';

// 初始化网站信息
// 注：站点标题/副标题不再从 config.js 读取，改由 locales/*.json 里的 site.title / site.subtitle 提供，
// 并通过 index.html 上的 data-i18n 属性自动跟随语言切换而更新，避免切换语言后标题仍然固定为中文
function initSiteConfig() {
  const { favicon } = config.site;

  // 设置 favicon（如果配置了）
  if (favicon) {
    let link = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = favicon;
  }
}

// 初始化书架配置
function initLibraryConfig() {
  const { heading, eyebrow } = config.library;
  
  const libraryHeading = document.querySelector('.sidebar-heading h2');
  const libraryEyebrow = document.querySelector('.sidebar-heading .eyebrow');
  
  if (libraryHeading) libraryHeading.textContent = heading;
  if (libraryEyebrow) libraryEyebrow.textContent = eyebrow;
}

// 初始化社交链接
function initSocialLinks() {
  const socialContainer = document.querySelector('.social-links');
  if (!socialContainer) return;
  
  // 清空现有内容
  socialContainer.innerHTML = '';
  
  const { github, bluesky, email } = config.social;
  
  // GitHub
  if (github.enabled && github.url) {
    socialContainer.appendChild(createSocialLink(
      github.url,
      'GitHub',
      '<path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>'
    ));
  }
  
  // Bluesky
  if (bluesky.enabled && bluesky.url) {
    socialContainer.appendChild(createSocialLink(
      bluesky.url,
      'Bluesky',
      '<path d="M12 10.5c-2.5-2.5-5.5-5.5-6.5-6.5C4.5 3 3 3 2 4.5S1.5 8 3 9.5c1 1 4 4 6 6-2 2-5 5-6 6C1.5 23 1.5 24 3 24s2.5-1 3.5-2c1-1 4-4 5.5-5.5 1.5 1.5 4.5 4.5 5.5 5.5 1 1 2 2 3.5 2s1.5-1 0-2.5c-1-1-4-4-6-6 2-2 5-5 6-6 1.5-1.5 1-3 0-4.5S19.5 3 18.5 4c-1 1-4 4-6.5 6.5z"/>'
    ));
  }
  
  // Email
  if (email.enabled && email.url) {
    socialContainer.appendChild(createSocialLink(
      email.url,
      'Email',
      '<path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>'
    ));
  }
  
  // 如果没有启用任何社交链接，隐藏容器
  if (socialContainer.children.length === 0) {
    socialContainer.style.display = 'none';
  }
}

function createSocialLink(url, label, svgPath) {
  const link = document.createElement('a');
  link.href = url;
  link.className = 'social-link';
  link.setAttribute('aria-label', label);
  
  // 如果是外部链接，添加 target 和 rel
  if (url.startsWith('http')) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
  
  link.innerHTML = `
    <svg viewBox="0 0 24 24" fill="currentColor">
      ${svgPath}
    </svg>
  `;
  
  return link;
}

// 初始化 UI 配置
function initUIConfig() {
  const { showBookCount, defaultEpubMode } = config.ui;
  
  // 控制书籍数量显示
  const bookCount = $('#book-count');
  if (bookCount && !showBookCount) {
    bookCount.style.display = 'none';
  }
  
  // 设置默认 EPUB 模式
  state.epubMode = defaultEpubMode;
}

// 导出初始化函数
export function initConfig() {
  console.log('initConfig 开始执行...');
  console.log('Config:', config);
  
  initSiteConfig();
  initLibraryConfig();
  initSocialLinks();
  initUIConfig();
  
  console.log('initConfig 完成！');
}

// 导出配置对象供其他模块使用
export { config };
