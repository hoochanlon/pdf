// 书籍封面管理（静态封面 + 内存缓存 + 预加载）

import { siteUrl } from './utils.js';

/**
 * 内存缓存：file -> coverUrl | null
 * null 表示已确认没有封面，避免重复请求
 */
const coverCache = new Map();

/**
 * 获取封面文件名
 * "category/book.pdf" -> "category-book.jpg"
 */
function getCoverFileName(bookFile) {
  const lastDot = bookFile.lastIndexOf('.');
  const baseName = lastDot > 0 ? bookFile.substring(0, lastDot) : bookFile;
  return baseName.replace(/\//g, '-') + '.jpg';
}

/**
 * 用 Image 对象真正加载图片，确保图片进入浏览器缓存
 * 返回加载成功的 URL，失败返回 null
 */
function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload  = () => resolve(url);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * 获取书籍封面 URL（带缓存）
 * 命中缓存时同步返回（包装在 Promise 里），否则发请求并缓存结果
 */
export async function getBookCover(file) {
  if (coverCache.has(file)) {
    return coverCache.get(file);
  }

  const coverFileName = getCoverFileName(file);
  const url = siteUrl(`./covers/${coverFileName}`);
  const result = await loadImage(url);

  coverCache.set(file, result); // null 也缓存，避免重复请求
  return result;
}

/**
 * 批量预加载封面，所有图片加载完（或失败）后才 resolve
 * 渲染书架前调用，保证列表出现时封面已在浏览器缓存中
 *
 * @param {string[]} files  书籍文件路径列表
 * @param {number}   timeout 单张图片超时 ms（默认 4000）
 */
export async function preloadCovers(files, timeout = 4000) {
  const tasks = files.map((file) => {
    if (coverCache.has(file)) return Promise.resolve(); // 已缓存，跳过

    const coverFileName = getCoverFileName(file);
    const url = siteUrl(`./covers/${coverFileName}`);

    const load = loadImage(url).then((result) => {
      coverCache.set(file, result);
    });

    // 超时保护：超时视为无封面，不阻塞渲染
    const timer = new Promise((resolve) => setTimeout(resolve, timeout));
    return Promise.race([load, timer]);
  });

  await Promise.allSettled(tasks);
}
