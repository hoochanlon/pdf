// 工具函数
export const $ = (selector) => document.querySelector(selector);
export const isEpub = (name) => /\.epub$/i.test(name);
export const isMobile = () => window.matchMedia('(max-width: 768px)').matches;
export const fileUrl = (name) => `/uploads/${encodeURIComponent(name)}`;
