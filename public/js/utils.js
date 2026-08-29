// 工具函数
export const $ = (selector) => document.querySelector(selector);
export const isEpub = (name) => /\.epub$/i.test(name);
export const isMobile = () => window.matchMedia('(max-width: 768px)').matches;

// 以当前页面为基准解析路径，兼容 localhost 根路径和 GitHub Pages 的 /pdf/ 子路径。
export const siteUrl = (path) => new URL(path, document.baseURI).href;
export const bookListUrl = () => siteUrl('./books.json');
export const fileUrl = (name) => siteUrl(`./uploads/${encodeURIComponent(name)}`);
