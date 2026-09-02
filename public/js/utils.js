// 工具函数
export const $ = (selector) => document.querySelector(selector);
export const isEpub = (name) => /\.epub$/i.test(name);
export const isMobi = (name) => /\.(mobi|azw3?)$/i.test(name);
export const isMobile = () => window.matchMedia('(max-width: 768px)').matches;

// 以当前页面为基准解析路径，兼容 localhost 根路径和 GitHub Pages 的 /pdf/ 子路径。
export const siteUrl = (path) => new URL(path, document.baseURI).href;
export const bookListUrl = () => siteUrl('./books.json');
// 支持子文件夹路径，如 "tech/book.pdf" 或 "book.pdf"
export const fileUrl = (relativePath) => {
  const parts = relativePath.split('/').map(encodeURIComponent);
  return siteUrl(`./uploads/${parts.join('/')}`);
};

// 内联 SVG 图标（使用 currentColor，可通过 CSS color 控制颜色）
export const ICON_BOOK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" aria-hidden="true"><path fill="currentColor" d="M832 64H192c-17.7 0-32 14.3-32 32v832c0 17.7 14.3 32 32 32h640c17.7 0 32-14.3 32-32V96c0-17.7-14.3-32-32-32M668 345.9L621.5 312L572 347.4V124h96z"/></svg>`;

export const ICON_PAPER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" aria-hidden="true"><g fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9h4m-4 7h12m-12 4h12m-12 4h4m-6 5h16a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v22a2 2 0 0 0 2 2"/><circle cx="22" cy="9" r=".5" fill="currentColor"/></g></svg>`;
