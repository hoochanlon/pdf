// 书籍封面管理（静态封面 + 动态提取回退）

/**
 * 获取封面文件名（书籍文件名去除扩展名 + .jpg）
 */
function getCoverFileName(bookFile) {
  const lastDot = bookFile.lastIndexOf('.');
  const baseName = lastDot > 0 ? bookFile.substring(0, lastDot) : bookFile;
  return baseName + '.jpg';
}

/**
 * 获取书籍封面 URL
 * 优先使用静态封面图片，如果不存在则返回 null
 */
export async function getBookCover(file) {
  const coverFileName = getCoverFileName(file);
  const staticCoverUrl = `/covers/${coverFileName}`;
  
  // 尝试加载静态封面
  try {
    const response = await fetch(staticCoverUrl, { method: 'HEAD' });
    if (response.ok) {
      return staticCoverUrl;
    }
  } catch (error) {
    // 静态封面不存在，返回 null
  }
  
  return null;
}

/**
 * 预加载封面（检查静态封面是否存在）
 */
export async function preloadCovers(files) {
  // 不需要预加载，浏览器会自动处理图片加载
  // 这个函数保留是为了兼容现有代码
}

/**
 * 清理封面缓存（不再需要）
 */
export async function clearOldCovers(daysOld = 30) {
  // 静态封面不需要清理缓存
}
