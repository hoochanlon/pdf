// EPUB locations 缓存 & 生成模块
// 职责：
//   1) 用 localStorage 缓存每本书 locations 生成结果（key = 文件名前缀）
//   2) 提供 generateEPUBLocations：优先读缓存，否则调用 book.locations.generate(1200)
//   3) locations 准备好后：写入 state.epubLocationsReady + 触发 updateEPUBLocation 刷新 UI
//
// 缓存最多保存 30 本书，超过字典序淘汰（近似 LRU，不需要额外时间戳字段）。
import { state } from './state.js';
import { setEPUBProgress, updateEPUBLocation } from './epub-progress.js?v=16';

const LOCATIONS_CACHE_PREFIX = 'epub-locations:';
const LOCATIONS_CACHE_MAX = 30;

function getLocationsCacheKey(filename) {
  return LOCATIONS_CACHE_PREFIX + filename.split('/').pop().split('?')[0];
}

function loadLocationsCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { locations, spine } = JSON.parse(raw);
    if (!Array.isArray(locations) || !locations.length) return null;
    return { locations, spine };
  } catch {
    return null;
  }
}

function saveLocationsCache(key, locations, spine) {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(LOCATIONS_CACHE_PREFIX)) keys.push(k);
    }
    if (keys.length >= LOCATIONS_CACHE_MAX) {
      keys.sort();
      const dropCount = Math.max(1, (keys.length + 1) - LOCATIONS_CACHE_MAX);
      for (let i = 0; i < dropCount; i++) localStorage.removeItem(keys[i]);
    }
    localStorage.setItem(key, JSON.stringify({ locations, spine }));
  } catch (err) {
    console.warn('[EPUB locations cache] 保存失败:', err);
  }
}

/**
 * 触发 locations 生成（带缓存）。renderEPUB 在完成 rendition.display 后调用。
 * 使用 requestIdleCallback / setTimeout 延后，避免阻塞首屏。
 */
export async function generateEPUBLocations(book, requestId, renderToken) {
  const cacheKey = getLocationsCacheKey(state.epubUrl || state.activeFile || '');
  const spineCount = book.spine?.spineItems?.length ?? 0;

  const run = async () => {
    try {
      const cached = loadLocationsCache(cacheKey);
      if (cached && cached.spine === spineCount && cached.locations.length > 1) {
        book.locations.load(cached.locations);
      } else {
        const locations = await new Promise((resolve, reject) => {
          const timeoutId = window.setTimeout(
            () => reject(new Error('locations.generate 超时')),
            30000,
          );
          Promise.resolve(book.locations.generate(1200))
            .then((v) => { window.clearTimeout(timeoutId); resolve(v); })
            .catch((e) => { window.clearTimeout(timeoutId); reject(e); });
        });
        if (requestId !== state.requestId || renderToken !== state.epubRenderToken) return;
        if (locations?.length > 1) saveLocationsCache(cacheKey, locations, spineCount);
      }

      if (requestId !== state.requestId || renderToken !== state.epubRenderToken) return;
      state.epubLocationsReady = book.locations.length() > 1;
      state.epubTotalPages = Math.max(0, book.locations.length() - 1);
      const current = state.rendition?.currentLocation?.();
      if (current?.then) updateEPUBLocation(await current);
      else if (current) updateEPUBLocation(current);
      else setEPUBProgress(0);
    } catch (error) {
      if (requestId === state.requestId && renderToken === state.epubRenderToken) {
        console.warn('EPUB 页码生成失败:', error);
        state.epubStatus = 'ready';
        setEPUBProgress(0);
      }
    }
  };
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 1800 });
  else window.setTimeout(run, 500);
}
