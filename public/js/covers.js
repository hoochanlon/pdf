// 书籍封面提取和缓存
import { isEpub } from './utils.js';

const DB_NAME = 'BookCoversDB';
const DB_VERSION = 1;
const STORE_NAME = 'covers';
const THUMBNAIL_SIZE = 300; // 缩略图宽度

let db = null;

// 初始化 IndexedDB
async function initDB() {
  if (db) return db;
  
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
    
    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'file' });
      }
    };
  });
}

// 从 IndexedDB 获取封面
async function getCoverFromCache(file) {
  try {
    const database = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(file);
      
      request.onsuccess = () => resolve(request.result?.dataUrl || null);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('获取封面缓存失败:', error);
    return null;
  }
}

// 保存封面到 IndexedDB
async function saveCoverToCache(file, dataUrl) {
  try {
    const database = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put({ file, dataUrl, timestamp: Date.now() });
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('保存封面缓存失败:', error);
  }
}

// 等待 PDF.js 加载
function waitForPDFjs(timeout = 10000) {
  return new Promise((resolve, reject) => {
    if (typeof pdfjsLib !== 'undefined') {
      resolve();
      return;
    }
    
    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      if (typeof pdfjsLib !== 'undefined') {
        clearInterval(checkInterval);
        resolve();
      } else if (Date.now() - startTime > timeout) {
        clearInterval(checkInterval);
        reject(new Error('PDF.js 加载超时'));
      }
    }, 100);
  });
}

// 从 PDF 提取第一页作为封面
async function extractPDFCover(fileUrl) {
  try {
    // 等待 PDF.js 加载完成
    await waitForPDFjs();
    
    console.log('[extractPDFCover] 开始提取封面:', fileUrl);
    
    // 配置 PDF.js worker
    if (pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    }
    
    const loadingTask = pdfjsLib.getDocument({
      url: fileUrl,
      cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
      cMapPacked: true
    });
    
    const pdf = await loadingTask.promise;
    console.log('[extractPDFCover] PDF加载成功，总页数:', pdf.numPages);
    
    const page = await pdf.getPage(1);
    console.log('[extractPDFCover] 第1页加载成功');
    
    const viewport = page.getViewport({ scale: 1 });
    const scale = THUMBNAIL_SIZE / viewport.width;
    const scaledViewport = page.getViewport({ scale });
    
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = scaledViewport.width;
    canvas.height = scaledViewport.height;
    
    console.log('[extractPDFCover] 开始渲染，尺寸:', canvas.width, 'x', canvas.height);
    
    await page.render({
      canvasContext: context,
      viewport: scaledViewport
    }).promise;
    
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    console.log('[extractPDFCover] 封面提取成功，大小:', Math.round(dataUrl.length / 1024), 'KB');
    
    // 清理
    await pdf.destroy();
    
    return dataUrl;
  } catch (error) {
    console.error('[extractPDFCover] 提取 PDF 封面失败:', error);
    return null;
  }
}

// 从 EPUB 提取封面
async function extractEPUBCover(fileUrl) {
  try {
    if (typeof ePub === 'undefined') {
      console.warn('EPUB.js 未加载');
      return null;
    }
    
    const book = ePub(fileUrl);
    await book.ready;
    
    // 尝试从 metadata 获取封面
    const cover = await book.coverUrl();
    
    if (cover) {
      // 将封面转换为 data URL
      const response = await fetch(cover);
      const blob = await response.blob();
      
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
    }
    
    // 如果没有封面，尝试渲染第一页
    await book.locations.generate(100);
    const section = book.section(book.spine.get(0));
    
    // EPUB 封面提取较复杂，暂时返回 null
    return null;
  } catch (error) {
    console.error('提取 EPUB 封面失败:', error);
    return null;
  }
}

// 获取书籍封面（优先从缓存读取）
export async function getBookCover(file) {
  console.log('[getBookCover] 请求封面:', file);
  
  // 先尝试从缓存获取
  const cached = await getCoverFromCache(file);
  if (cached) {
    console.log('[getBookCover] 从缓存加载封面:', file);
    return cached;
  }
  
  console.log('[getBookCover] 缓存未命中，开始提取封面:', file);
  
  // 缓存未命中，提取封面
  const fileUrl = `/uploads/${file}`;
  let coverDataUrl = null;
  
  if (isEpub(file)) {
    console.log('[getBookCover] 识别为EPUB文件');
    coverDataUrl = await extractEPUBCover(fileUrl);
  } else {
    console.log('[getBookCover] 识别为PDF文件');
    coverDataUrl = await extractPDFCover(fileUrl);
  }
  
  // 保存到缓存
  if (coverDataUrl) {
    console.log('[getBookCover] 封面提取成功，保存到缓存');
    await saveCoverToCache(file, coverDataUrl);
  } else {
    console.warn('[getBookCover] 封面提取失败:', file);
  }
  
  return coverDataUrl;
}

// 预加载书籍封面（后台任务）
export async function preloadCovers(files) {
  for (const file of files) {
    // 检查是否已有缓存
    const cached = await getCoverFromCache(file);
    if (cached) continue;
    
    // 提取并缓存封面
    await getBookCover(file);
    
    // 避免阻塞，添加延迟
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

// 清理旧的封面缓存（可选）
export async function clearOldCovers(daysOld = 30) {
  try {
    const database = await initDB();
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.openCursor();
    
    const cutoffTime = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
    
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        if (cursor.value.timestamp < cutoffTime) {
          cursor.delete();
        }
        cursor.continue();
      }
    };
  } catch (error) {
    console.error('清理封面缓存失败:', error);
  }
}
