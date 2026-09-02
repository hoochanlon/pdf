// 本地书籍封面提取（轻量独立实现，不依赖 foliate-js 的类）
// • PDF  — PDF.js 渲染第一页到 canvas
// • EPUB — JSZip 解压，解析 OPF 找封面图片
// • MOBI/AZW3 — 直接解析二进制文件头，读取封面图片 record

const coverCache = new Map(); // localKey → blobUrl | null

// ── PDF.js（CDN，与主阅读器共享同一版本）─────────────────────

const PDF_VERSION    = '3.11.174';
const PDF_CORE_URL   = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDF_VERSION}/pdf.min.js`;
const PDF_WORKER_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDF_VERSION}/pdf.worker.min.js`;

function loadScript(url, globalName) {
  if (window[globalName]) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url; s.async = false;
    s.onload  = () => window[globalName] ? resolve() : reject(new Error(`${globalName} missing`));
    s.onerror = () => reject(new Error(`load failed: ${url}`));
    document.head.appendChild(s);
  });
}

async function extractPDFCover(file) {
  await loadScript(PDF_CORE_URL, 'pdfjsLib');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;

  const data = await file.arrayBuffer();
  const pdf  = await window.pdfjsLib.getDocument({ data }).promise;
  try {
    const page     = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const scale    = Math.min(1, 320 / viewport.width);
    const scaled   = page.getViewport({ scale });
    const canvas   = document.createElement('canvas');
    canvas.width   = Math.floor(scaled.width);
    canvas.height  = Math.floor(scaled.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: scaled }).promise;
    return await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.82));
  } finally {
    pdf.destroy().catch(() => {});
  }
}

// ── EPUB — 用 JSZip 解压，解析 OPF ────────────────────────────

async function ensureJSZip() {
  if (typeof window.JSZip === 'function') return;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

// 解析 XML 字符串
function parseXML(str) {
  return new DOMParser().parseFromString(str, 'application/xml');
}

// 解析路径，返回目录
function dirname(path) {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(0, i + 1) : '';
}

// 相对路径解析（简化版，足够处理 EPUB 内部路径）
function resolveEpubPath(base, rel) {
  if (!rel) return '';
  if (/^[a-z]+:/i.test(rel)) return rel;  // 绝对 URL，跳过
  const dir = dirname(base);
  // 把 base 目录和 rel 拼接，然后规范化
  let parts = (dir + rel).split('/');
  const result = [];
  for (const p of parts) {
    if (p === '..') result.pop();
    else if (p !== '.') result.push(p);
  }
  return result.join('/');
}

async function extractEPUBCover(file) {
  await ensureJSZip();
  const zip = await window.JSZip.loadAsync(file);

  // 1. 读 META-INF/container.xml 找 OPF 路径
  const containerText = await zip.file('META-INF/container.xml')?.async('text');
  if (!containerText) return null;
  const containerDoc = parseXML(containerText);
  const opfPath = containerDoc
    .querySelector('rootfile[media-type="application/oebps-package+xml"]')
    ?.getAttribute('full-path');
  if (!opfPath) return null;

  // 2. 读 OPF
  const opfText = await zip.file(opfPath)?.async('text');
  if (!opfText) return null;
  const opf = parseXML(opfText);
  const opfDir = dirname(opfPath);

  // 3. 找封面图片的 href —— 按优先级逐一尝试
  let coverHref = null;

  // 方法 A：manifest item 带 properties="cover-image"（EPUB 3）
  const coverItem = opf.querySelector('manifest item[properties~="cover-image"]');
  if (coverItem) coverHref = coverItem.getAttribute('href');

  // 方法 B：meta name="cover" 指向的 item id（EPUB 2）
  if (!coverHref) {
    const coverId = opf.querySelector('meta[name="cover"]')?.getAttribute('content');
    if (coverId) {
      coverHref = opf.querySelector(`manifest item[id="${coverId}"]`)?.getAttribute('href');
    }
  }

  // 方法 C：guide reference type="cover"
  if (!coverHref) {
    const guideRef = opf.querySelector('guide reference[type="cover"]');
    if (guideRef) {
      // guide href 可能是 HTML 文件，需要进入该文件找第一张图
      const guideHref = resolveEpubPath(opfPath, guideRef.getAttribute('href')?.split('#')[0]);
      const html = await zip.file(guideHref)?.async('text');
      if (html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const imgSrc = doc.querySelector('img')?.getAttribute('src');
        if (imgSrc) coverHref = resolveEpubPath(guideHref, imgSrc);
      }
    }
  }

  if (!coverHref) return null;

  // 4. 读取图片文件
  const fullPath = resolveEpubPath(opfPath, coverHref);
  const imgEntry = zip.file(fullPath)
    ?? zip.file(decodeURIComponent(fullPath))
    ?? zip.file(encodeURIComponent(fullPath));
  if (!imgEntry) return null;

  const imgData = await imgEntry.async('arraybuffer');

  // 推断 MIME 类型（用文件扩展名兜底）
  const ext  = fullPath.split('.').pop().toLowerCase();
  const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
                 gif: 'image/gif',  webp: 'image/webp', svg: 'image/svg+xml' }[ext]
             ?? 'image/jpeg';
  return new Blob([imgData], { type: mime });
}

// ── MOBI/AZW3 — 直接解析二进制文件头 ─────────────────────────

function getUint16BE(buf, offset) {
  return (buf[offset] << 8) | buf[offset + 1];
}
function getUint32BE(buf, offset) {
  return ((buf[offset] << 24) | (buf[offset + 1] << 16)
        | (buf[offset + 2] << 8) | buf[offset + 3]) >>> 0;
}
function getString(buf, offset, len) {
  return String.fromCharCode(...buf.slice(offset, offset + len));
}

async function extractMOBICover(file) {
  // 只读前 128KB，够解析所有头部信息和 record 偏移
  const headerSlice = await file.slice(0, 131072).arrayBuffer();
  const buf = new Uint8Array(headerSlice);

  // PDB 头：78 字节之前是文件名等，76-77 是记录数
  const magic = getString(buf, 60, 4) + getString(buf, 64, 4);
  if (!magic.startsWith('BOOKMOBI') && !magic.startsWith('TEXtREAd')) {
    return null; // 不是 MOBI 文件
  }

  const numRecords = getUint16BE(buf, 76);
  if (numRecords < 1) return null;

  // 读所有 record 偏移（每条 8 字节：4 偏移 + 4 属性）
  // PDB record list 从 byte 78 开始
  const recordOffsets = [];
  for (let i = 0; i < numRecords; i++) {
    recordOffsets.push(getUint32BE(buf, 78 + i * 8));
  }

  // record 0 包含 PalmDOC + MOBI + EXTH 头
  const rec0Start = recordOffsets[0];
  // 需要读完整 record 0；整个文件已在 headerSlice 里（128KB 够用）
  const mobi = buf.slice(rec0Start, rec0Start + 256);

  // 检查 MOBI magic
  if (getString(mobi, 16, 4) !== 'MOBI') return null;

  const mobiLength  = getUint32BE(mobi, 20);
  const exthFlag    = getUint32BE(mobi, 128);
  const hasExth     = !!(exthFlag & 0x40);
  if (!hasExth) return null;

  // EXTH 从 record0_start + 16 (PalmDOC) + mobiLength 开始
  const exthStart = rec0Start + 16 + mobiLength;
  const exthMagic = getString(buf, exthStart, 4);
  if (exthMagic !== 'EXTH') return null;

  const exthCount = getUint32BE(buf, exthStart + 8);
  let pos = exthStart + 12;
  let coverOffset = 0xffffffff;
  let thumbnailOffset = 0xffffffff;

  for (let i = 0; i < exthCount; i++) {
    const type   = getUint32BE(buf, pos);
    const length = getUint32BE(buf, pos + 4);
    if (type === 201) coverOffset    = getUint32BE(buf, pos + 8);
    if (type === 202) thumbnailOffset = getUint32BE(buf, pos + 8);
    pos += length;
    if (pos + 8 > buf.length) break;
  }

  const offset = coverOffset    < 0xffffffff ? coverOffset
               : thumbnailOffset < 0xffffffff ? thumbnailOffset
               : null;
  if (offset === null) return null;

  // resourceStart：MOBI 头偏移 108 处
  const resourceStart = getUint32BE(mobi, 108);
  const targetRecord  = resourceStart + offset;
  if (targetRecord >= numRecords) return null;

  // 读取目标 record（图片数据）
  const imgStart = recordOffsets[targetRecord];
  const imgEnd   = recordOffsets[targetRecord + 1] ?? file.size;
  const imgBlob  = file.slice(imgStart, imgEnd);
  const imgBuf   = new Uint8Array(await imgBlob.arrayBuffer());

  // 识别图片格式
  let mime = 'image/jpeg';
  if (imgBuf[0] === 0x89 && imgBuf[1] === 0x50) mime = 'image/png';
  else if (imgBuf[0] === 0x47 && imgBuf[1] === 0x49) mime = 'image/gif';

  return new Blob([imgBuf], { type: mime });
}

// ── 公开 API ──────────────────────────────────────────────────

export async function getLocalCover(key, file) {
  if (coverCache.has(key)) return coverCache.get(key);

  let blob = null;
  try {
    const name = file.name.toLowerCase();
    if (name.endsWith('.pdf')) {
      blob = await extractPDFCover(file);
    } else if (name.endsWith('.epub')) {
      blob = await extractEPUBCover(file);
    } else if (/\.(mobi|azw3?)$/.test(name)) {
      blob = await extractMOBICover(file);
    }
  } catch (err) {
    console.warn(`[LocalCovers] 封面提取失败 (${file.name}):`, err);
  }

  const url = blob ? URL.createObjectURL(blob) : null;
  coverCache.set(key, url);
  return url;
}

export function revokeLocalCover(key) {
  const url = coverCache.get(key);
  if (url) URL.revokeObjectURL(url);
  coverCache.delete(key);
}

export function revokeAllLocalCovers() {
  for (const url of coverCache.values()) {
    if (url) URL.revokeObjectURL(url);
  }
  coverCache.clear();
}
