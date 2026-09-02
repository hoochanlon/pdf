// 本地书库模块 —— 基于 File System Access API（Chrome/Edge 86+）
// • IndexedDB 持久化 FileSystemHandle，刷新后自动恢复
// • 独立搜索、作者筛选、阅读状态筛选、列表/网格排列
// • 支持单本删除、一键清空（不删除实际文件）

import { $, isEpub, isMobi } from './utils.js';
import { getBookReadingStatus, getBookReadingProgress, getBookReadingLocation, clearBookReadingStatus, clearAllReadingStatus } from './reading.js';
import { CustomSelect } from './select.js';
import { getLocalCover, revokeLocalCover, revokeAllLocalCovers } from './local-covers.js';

const SUPPORTED_EXTENSIONS = /\.(pdf|epub|mobi|azw3?)$/i;
const IDB_NAME    = 'local-library';
const IDB_VERSION = 1;
const IDB_STORE   = 'entries';   // { id: name, name, handle | null, isFile: bool }

const STATUS_OPTIONS = [
  { value: 'unread', label: '未读' },
  { value: 'read',   label: '已读' }
];

// ── 模块状态 ──────────────────────────────────────────────────
let localBooks       = [];   // 规范化书目
let rawEntries       = [];   // { name, handle|null, file|null, blobUrl|null }
let openLocalBookHandler  = null;
let currentLocalActiveFile = null;
let localControlsBound     = false;
let localCurrentView = localStorage.getItem('local-library-view') || 'list';

const localFilters = { query: '', author: '', status: '' };
let csLocalAuthor = null;
let csLocalStatus = null;

// ── IndexedDB ─────────────────────────────────────────────────

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(IDB_STORE, { keyPath: 'name' });
    };
    req.onsuccess  = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror    = (e) => reject(e.target.error);
  });
}

async function idbGetAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE, 'readonly')
                  .objectStore(IDB_STORE).getAll();
    req.onsuccess = (e) => resolve(e.target.result || []);
    req.onerror   = (e) => reject(e.target.error);
  });
}

async function idbPut(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE, 'readwrite')
                  .objectStore(IDB_STORE).put(record);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

async function idbDelete(name) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE, 'readwrite')
                  .objectStore(IDB_STORE).delete(name);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

async function idbClear() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE, 'readwrite')
                  .objectStore(IDB_STORE).clear();
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

// ── key 工具 ──────────────────────────────────────────────────

export function localKey(name) {
  return `__local__/${name}`;
}

// ── 推断元数据 ────────────────────────────────────────────────

function inferFormat(name) {
  return (name.match(/\.([^.]+)$/)?.[1] || '').toUpperCase();
}

function inferTitle(name) {
  const base = name.replace(/\.[^.]+$/, '');
  const quoted = base.match(/^《([^》]+)》/);
  if (quoted) return quoted[1].trim();
  const sep = Math.max(base.lastIndexOf('-'), base.lastIndexOf('—'), base.lastIndexOf('–'));
  return sep > 0 ? base.slice(0, sep).trim() : base;
}

function inferAuthor(name) {
  const base = name.replace(/\.[^.]+$/, '');
  const sep = Math.max(base.lastIndexOf('-'), base.lastIndexOf('—'), base.lastIndexOf('–'));
  return sep > 0 ? base.slice(sep + 1).trim() : '';
}

function normalizeLocalBook(entry) {
  return {
    name:   entry.name,
    key:    localKey(entry.name),
    title:  inferTitle(entry.name),
    author: inferAuthor(entry.name) || '未知作者',
    format: inferFormat(entry.name),
  };
}

function formatReadingProgress(key) {
  const progress = getBookReadingProgress(key);
  const location = getBookReadingLocation(key);
  if (progress === 0 && !location) return '';
  const pct = Math.round(progress * 100);
  if (location?.kind === 'pdf-page') return `第${location.value}页 (${pct}%)`;
  return pct > 0 ? `${pct}%` : '';
}

// ── 筛选 ──────────────────────────────────────────────────────

function normalizeText(v) {
  return String(v ?? '').trim().toLocaleLowerCase();
}

function hasActiveLocalFilters() {
  return Boolean(localFilters.query || localFilters.author || localFilters.status);
}

function matchesLocalFilters(book) {
  const q    = normalizeText(localFilters.query);
  const text = normalizeText(`${book.title} ${book.author}`);
  return (!q || text.includes(q))
    && (!localFilters.author || book.author === localFilters.author)
    && (!localFilters.status || getBookReadingStatus(book.key) === localFilters.status);
}

// ── 目录扫描 ──────────────────────────────────────────────────

async function scanDirectory(dirHandle, depth = 0) {
  const results = [];
  if (depth > 2) return results;
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === 'file' && SUPPORTED_EXTENSIONS.test(name)) {
      results.push({ name, handle });
    } else if (handle.kind === 'directory' && depth < 2) {
      results.push(...await scanDirectory(handle, depth + 1));
    }
  }
  return results;
}

// ── 骨架屏 ────────────────────────────────────────────────────

function renderLocalSkeletons(count = 4) {
  const list = $('#local-book-list');
  if (!list) return;
  list.classList.add('is-loading');
  list.replaceChildren();
  for (let i = 0; i < count; i++) {
    const sk = document.createElement('li');
    sk.className = 'book-skeleton';
    sk.innerHTML = `
      <div class="book-skeleton-thumb"></div>
      <div class="book-skeleton-body">
        <div class="book-skeleton-line title"></div>
        <div class="book-skeleton-line title2"></div>
        <div class="book-skeleton-line author"></div>
        <div class="book-skeleton-line badge"></div>
      </div>`;
    list.appendChild(sk);
  }
}

// ── 筛选器选项 ────────────────────────────────────────────────

function populateLocalFilterOptions() {
  const authorCounts = new Map();
  const statusCounts = new Map();
  localBooks.forEach((book) => {
    authorCounts.set(book.author, (authorCounts.get(book.author) || 0) + 1);
    const s = getBookReadingStatus(book.key);
    statusCounts.set(s, (statusCounts.get(s) || 0) + 1);
  });

  const makeOpt = (value, label, count) => ({ value, label: `${label} (${count})` });
  const authorOpts = [
    { value: '', label: '全部作者' },
    ...[...authorCounts.keys()]
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))
      .map(a => makeOpt(a, a, authorCounts.get(a)))
  ];
  const statusOpts = [
    { value: '', label: '全部状态' },
    ...STATUS_OPTIONS.map(s => makeOpt(s.value, s.label, statusCounts.get(s.value) || 0))
  ];

  if (csLocalAuthor) {
    const cur = csLocalAuthor.getValue();
    csLocalAuthor.setOptions(authorOpts);
    if (!authorOpts.some(o => o.value === cur)) csLocalAuthor.setValue('', true);
  }
  if (csLocalStatus) {
    const cur = csLocalStatus.getValue();
    csLocalStatus.setOptions(statusOpts);
    if (!statusOpts.some(o => o.value === cur)) csLocalStatus.setValue('', true);
  }
}

function updateLocalFilterSummary() {
  const active = [localFilters.query, localFilters.author, localFilters.status].filter(Boolean).length;
  const toggle = $('#local-filter-toggle');
  const count  = $('#local-filter-count');
  if (!toggle || !count) return;
  count.textContent = active;
  count.hidden = active === 0;
  toggle.classList.toggle('is-active', active > 0);
  toggle.setAttribute('aria-label', active ? `筛选，${active}项已启用` : '筛选');
}

// ── 书目条目构建 ──────────────────────────────────────────────

function buildLocalBookItem(book) {
  const progressInfo = formatReadingProgress(book.key);
  const epub = isEpub(book.name);
  const mobi = isMobi(book.name);

  const item = document.createElement('li');
  item.className = 'book-item local-book-item';
  if (epub) item.classList.add('epub-book');
  if (mobi) item.classList.add('mobi-book');
  item.classList.toggle('active', currentLocalActiveFile === book.name);
  item.dataset.localFile = book.name;
  item.setAttribute('role', 'button');
  item.tabIndex = 0;

  // 删除按钮（右上角，阻止冒泡避免触发打开）
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'local-delete-btn';
  deleteBtn.type = 'button';
  deleteBtn.setAttribute('aria-label', `从书库中移除 ${book.title}`);
  deleteBtn.innerHTML = '×';
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    removeLocalEntry(book.name);
  });

  // 清除阅读进度按钮（删除按钮左侧，悬停显示）
  const clearStatusBtn = document.createElement('button');
  clearStatusBtn.className = 'local-delete-btn local-clear-status-btn';
  clearStatusBtn.type = 'button';
  clearStatusBtn.setAttribute('aria-label', `清除《${book.title}》的阅读进度`);
  clearStatusBtn.innerHTML = '↺';
  clearStatusBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clearBookReadingStatus(book.key);
  });

  if (localCurrentView === 'grid') {
    const formatBadge = document.createElement('span');
    formatBadge.className = 'book-format-badge';
    formatBadge.textContent = book.format;

    const cover = document.createElement('div');
    cover.className = 'book-cover no-cover';
    const coverImg = document.createElement('img');
    coverImg.className = 'book-cover-image';
    coverImg.alt = book.title;
    cover.appendChild(coverImg);
    const coverTitle = document.createElement('div');
    coverTitle.className = 'book-cover-title';
    coverTitle.textContent = book.title;
    cover.appendChild(coverTitle);

    const footer = document.createElement('div');
    footer.className = 'book-footer';
    const footerInfo = document.createElement('div');
    footerInfo.className = 'book-footer-info';
    const footerAuthor = document.createElement('span');
    footerAuthor.className = 'book-footer-author';
    footerAuthor.textContent = book.author;
    footerInfo.appendChild(footerAuthor);

    const progress = getBookReadingProgress(book.key);
    const progressWrap = document.createElement('div');
    progressWrap.className = 'book-progress-wrap';
    const progressBar = document.createElement('div');
    progressBar.className = 'book-progress-bar';
    progressBar.style.width = `${progress * 100}%`;
    if (progressInfo) {
      const progressText = document.createElement('span');
      progressText.className = 'book-progress-text';
      progressText.textContent = progressInfo;
      progressWrap.appendChild(progressText);
    }
    progressWrap.appendChild(progressBar);
    footer.append(footerInfo, progressWrap);

    item.append(formatBadge, cover, footer, clearStatusBtn, deleteBtn);

  } else {
    const thumb = document.createElement('div');
    thumb.className = 'book-cover-thumb';
    const thumbImg = document.createElement('img');
    thumbImg.className = 'book-cover-thumb-image';
    thumbImg.alt = book.title;
    thumb.appendChild(thumbImg);
    const badge = document.createElement('span');
    badge.className = 'book-cover-thumb-badge';
    badge.textContent = book.format;
    thumb.appendChild(badge);

    const info = document.createElement('span');
    info.className = 'book-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'book-name';
    nameEl.textContent = book.title;

    const authorRow = document.createElement('div');
    authorRow.className = 'book-meta book-author-row';
    const authorText = document.createElement('span');
    authorText.className = 'book-author';
    authorText.textContent = book.author;
    authorRow.appendChild(authorText);
    if (progressInfo) {
      const progressEl = document.createElement('span');
      progressEl.className = 'book-progress-info';
      progressEl.textContent = progressInfo;
      authorRow.appendChild(progressEl);
    }

    const formatRow = document.createElement('div');
    formatRow.className = 'book-meta book-category';
    const formatBadgeEl = document.createElement('span');
    formatBadgeEl.className = 'category-badge';
    formatBadgeEl.textContent = book.format;
    formatRow.appendChild(formatBadgeEl);

    info.append(nameEl, authorRow, formatRow);

    const arrow = document.createElement('span');
    arrow.className = 'book-arrow';
    arrow.textContent = '›';

    item.append(thumb, info, arrow, clearStatusBtn, deleteBtn);
  }

  const rawEntry = rawEntries.find(e => e.name === book.name);
  item.addEventListener('click', () => rawEntry && handleOpenLocalBook(rawEntry));
  item.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && rawEntry) {
      e.preventDefault();
      handleOpenLocalBook(rawEntry);
    }
  });
  item.addEventListener('animationend', () => item.classList.add('entered'), { once: true });
  return item;
}

// ── 封面懒加载 ────────────────────────────────────────────────

async function loadCoversForVisible(visibleBooks) {
  for (const book of visibleBooks) {
    const entry = rawEntries.find(e => e.name === book.name);
    if (!entry) continue;

    // 需要有 File 对象才能提取封面；Handle 条目打开过才有 file
    // 未打开的 Handle 条目：尝试静默获取（不弹权限框）
    let file = entry.file;
    if (!file && entry.handle) {
      try {
        const perm = await entry.handle.queryPermission({ mode: 'read' });
        if (perm === 'granted') file = await entry.handle.getFile();
      } catch { /* 没权限就跳过封面 */ }
    }
    if (!file) continue;

    // 异步提取，不 await 全部完成，每张就绪就立刻更新
    getLocalCover(book.key, file).then(url => {
      if (!url) return;
      // 更新列表视图缩略图
      const thumbImg = document.querySelector(
        `.local-book-item[data-local-file="${CSS.escape(book.name)}"] .book-cover-thumb-image`
      );
      if (thumbImg) {
        thumbImg.onload = () => thumbImg.classList.add('loaded');
        thumbImg.src = url;
        if (thumbImg.complete && thumbImg.naturalWidth > 0) thumbImg.classList.add('loaded');
        thumbImg.closest('.book-cover-thumb')?.classList.remove('no-cover');
      }
      // 更新网格视图封面
      const coverImg = document.querySelector(
        `.local-book-item[data-local-file="${CSS.escape(book.name)}"] .book-cover-image`
      );
      if (coverImg) {
        coverImg.onload = () => coverImg.classList.add('loaded');
        coverImg.src = url;
        if (coverImg.complete && coverImg.naturalWidth > 0) coverImg.classList.add('loaded');
        coverImg.closest('.book-cover')?.classList.remove('no-cover');
      }
    }).catch(() => {});
  }
}

// ── 渲染 ──────────────────────────────────────────────────────

function renderLocalList() {
  const list    = $('#local-book-list');
  const emptyEl = $('#local-empty');
  const countEl = $('#local-count');
  if (!list) return;

  const visible   = localBooks.filter(matchesLocalFilters);
  const hasFilter = hasActiveLocalFilters();

  if (countEl) countEl.textContent = String(localBooks.length);
  const resetBtn = $('#local-filter-reset');
  if (resetBtn) resetBtn.disabled = !hasFilter;
  updateLocalFilterSummary();

  // 清空按钮：有书才显示
  const clearBtn = $('#local-clear-all');
  if (clearBtn) clearBtn.hidden = localBooks.length === 0;

  // 清除进度按钮：有书才显示
  const clearProgressBtn = $('#local-clear-progress');
  if (clearProgressBtn) clearProgressBtn.hidden = localBooks.length === 0;

  list.classList.add('is-loading');
  list.replaceChildren();

  if (!localBooks.length) {
    if (emptyEl) { emptyEl.hidden = false; emptyEl.innerHTML = '打开文件夹或选择文件后，<br>这里会显示你的本地电子书'; }
    requestAnimationFrame(() => list.classList.remove('is-loading'));
    return;
  }
  if (!visible.length) {
    if (emptyEl) { emptyEl.hidden = false; emptyEl.innerHTML = '没有匹配的书籍，<br>试试调整筛选条件'; }
    requestAnimationFrame(() => list.classList.remove('is-loading'));
    return;
  }
  if (emptyEl) emptyEl.hidden = true;

  visible.forEach(book => list.appendChild(buildLocalBookItem(book)));
  requestAnimationFrame(() => {
    list.classList.remove('is-loading');
    // DOM 就绪后异步提取封面，不阻塞列表渲染
    loadCoversForVisible(visible);
  });
}

// ── 删除 / 清空 ───────────────────────────────────────────────

async function removeLocalEntry(name) {
  const entry = rawEntries.find(e => e.name === name);
  if (entry?.blobUrl) URL.revokeObjectURL(entry.blobUrl);
  revokeLocalCover(localKey(name));
  rawEntries = rawEntries.filter(e => e.name !== name);
  localBooks = rawEntries.map(normalizeLocalBook);
  await idbDelete(name).catch(() => {});
  populateLocalFilterOptions();
  renderLocalList();
}

async function clearAllLocalEntries() {
  rawEntries.forEach(e => { if (e.blobUrl) URL.revokeObjectURL(e.blobUrl); });
  rawEntries = [];
  localBooks = [];
  await idbClear().catch(() => {});
  populateLocalFilterOptions();
  renderLocalList();
}

// ── 局部进度更新 ──────────────────────────────────────────────

function updateLocalBookProgress(key) {
  const name = key.replace(/^__local__\//, '');
  const item = document.querySelector(`.local-book-item[data-local-file="${CSS.escape(name)}"]`);
  if (!item) return;

  const progressInfo = formatReadingProgress(key);

  const progressBar = item.querySelector('.book-progress-bar');
  if (progressBar) progressBar.style.width = `${getBookReadingProgress(key) * 100}%`;

  const progressText = item.querySelector('.book-progress-text');
  if (progressText) {
    if (progressInfo) {
      progressText.textContent = progressInfo;
    } else {
      progressText.remove();
    }
  }

  const progressInfoEl = item.querySelector('.book-progress-info');
  if (progressInfoEl) {
    if (progressInfo) {
      progressInfoEl.textContent = progressInfo;
    } else {
      progressInfoEl.remove();
    }
  } else if (progressInfo) {
    const authorRow = item.querySelector('.book-author-row');
    if (authorRow) {
      const el = document.createElement('span');
      el.className = 'book-progress-info';
      el.textContent = progressInfo;
      authorRow.appendChild(el);
    }
  }
}

// ── 打开文件 ──────────────────────────────────────────────────

async function handleOpenLocalBook(entry) {
  try {
    let file;
    if (entry.handle) {
      // 检查权限，首次访问时浏览器会弹出确认
      const perm = await entry.handle.queryPermission({ mode: 'read' });
      if (perm !== 'granted') {
        await entry.handle.requestPermission({ mode: 'read' });
      }
      file = await entry.handle.getFile();
      if (entry.blobUrl) URL.revokeObjectURL(entry.blobUrl);
      entry.blobUrl = URL.createObjectURL(file);
      entry.file = file;
    } else {
      file = entry.file;
    }

    currentLocalActiveFile = entry.name;
    document.querySelectorAll('.local-book-item').forEach(el => {
      el.classList.toggle('active', el.dataset.localFile === entry.name);
    });

    if (openLocalBookHandler) {
      openLocalBookHandler({
        url:         entry.blobUrl,
        filename:    localKey(entry.name),
        displayName: entry.name,
        file,
        isLocal:     true
      });
    }
  } catch (error) {
    console.error('[LocalLibrary] 打开本地文件失败:', error);
    alert(`无法读取文件：${entry.name}\n${error.message}`);
  }
}

// ── 视图切换 ──────────────────────────────────────────────────

function updateLocalViewUI() {
  const list = $('#local-book-list');
  const icon = $('#local-view-icon');
  if (localCurrentView === 'grid') {
    list?.classList.remove('view-list');
    list?.classList.add('view-grid');
    if (icon) icon.textContent = '☰';
  } else {
    list?.classList.remove('view-grid');
    list?.classList.add('view-list');
    if (icon) icon.textContent = '⊞';
  }
}

// ── 持久化：保存 / 恢复 ───────────────────────────────────────

async function persistEntry(entry) {
  // input[type=file] 降级时没有 handle，只存文件名占位，不能跨会话恢复
  if (!entry.handle) return;
  await idbPut({ name: entry.name, handle: entry.handle }).catch(() => {});
}

async function restoreFromIDB() {
  try {
    const records = await idbGetAll();
    if (!records.length) return;
    const restored = records.map(r => ({ name: r.name, handle: r.handle, blobUrl: null, file: null }));
    restored.forEach(e => {
      if (!rawEntries.some(r => r.name === e.name)) rawEntries.push(e);
    });
    localBooks = rawEntries.map(normalizeLocalBook);
    populateLocalFilterOptions();
    renderLocalList();
  } catch (err) {
    console.warn('[LocalLibrary] IndexedDB 恢复失败:', err);
  }
}

// ── 添加书目 ──────────────────────────────────────────────────

async function addEntries(entries) {
  const newOnes = [];
  entries.forEach(e => {
    if (!rawEntries.some(r => r.name === e.name)) {
      rawEntries.push(e);
      newOnes.push(e);
    }
  });
  localBooks = rawEntries.map(normalizeLocalBook);
  populateLocalFilterOptions();
  renderLocalList();
  // 异步持久化，不阻塞 UI
  for (const e of newOnes) await persistEntry(e);
}

// ── 控件绑定 ──────────────────────────────────────────────────

function bindLocalControls() {
  if (localControlsBound) return;
  localControlsBound = true;

  // Tab 切换
  const tabOnline   = $('#tab-online');
  const tabLocal    = $('#tab-local');
  const panelOnline = $('#panel-online');
  const panelLocal  = $('#panel-local');

  const savedTab = localStorage.getItem('activeLibraryTab') || 'online';
  if (savedTab === 'local') {
    tabOnline.setAttribute('aria-selected', 'false');
    tabLocal.setAttribute('aria-selected', 'true');
    panelOnline.hidden = true;
    panelLocal.hidden  = false;
  }
  tabOnline.addEventListener('click', () => {
    tabOnline.setAttribute('aria-selected', 'true');
    tabLocal.setAttribute('aria-selected', 'false');
    panelOnline.hidden = false;
    panelLocal.hidden  = true;
    localStorage.setItem('activeLibraryTab', 'online');
    // 若当前打开的是本地书，切回在线书库时清空阅读区
    window.dispatchEvent(new CustomEvent('librarytabchange', { detail: { tab: 'online' } }));
  });
  tabLocal.addEventListener('click', () => {
    tabOnline.setAttribute('aria-selected', 'false');
    tabLocal.setAttribute('aria-selected', 'true');
    panelOnline.hidden = true;
    panelLocal.hidden  = false;
    localStorage.setItem('activeLibraryTab', 'local');
    // 若当前打开的是在线书，切到本地书库时清空阅读区
    window.dispatchEvent(new CustomEvent('librarytabchange', { detail: { tab: 'local' } }));
  });

  // 搜索
  $('#local-book-search')?.addEventListener('input', (e) => {
    localFilters.query = e.target.value;
    renderLocalList();
  });

  // 筛选器
  const makeLocalSelect = (wrapId, onChangeFn) => {
    const wrap = $(`#${wrapId}`);
    if (!wrap) return null;
    return new CustomSelect(
      wrap.querySelector('.cs-trigger'),
      wrap.querySelector('.cs-listbox'),
      { onChange: (v) => { onChangeFn(v); renderLocalList(); } }
    );
  };
  csLocalAuthor = makeLocalSelect('local-cs-author-wrap', (v) => { localFilters.author = v; });
  csLocalStatus = makeLocalSelect('local-cs-status-wrap', (v) => { localFilters.status = v; });
  csLocalAuthor?.setOptions([{ value: '', label: '全部作者' }]);
  csLocalStatus?.setOptions([{ value: '', label: '全部状态' }]);

  $('#local-filter-toggle')?.addEventListener('click', () => {
    const toggle   = $('#local-filter-toggle');
    const panel    = $('#local-filter-panel');
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    panel.hidden = expanded;
  });

  $('#local-filter-reset')?.addEventListener('click', () => {
    localFilters.query = '';
    localFilters.author = '';
    localFilters.status = '';
    const si = $('#local-book-search');
    if (si) si.value = '';
    csLocalAuthor?.setValue('', true);
    csLocalStatus?.setValue('', true);
    renderLocalList();
  });

  // 排列切换
  $('#local-view-toggle')?.addEventListener('click', () => {
    localCurrentView = localCurrentView === 'list' ? 'grid' : 'list';
    localStorage.setItem('local-library-view', localCurrentView);
    updateLocalViewUI();
    renderLocalList();
  });

  // 打开文件夹
  $('#local-open-dir')?.addEventListener('click', async () => {
    if (!window.showDirectoryPicker) {
      alert('你的浏览器不支持 File System Access API，请使用 Chrome 或 Edge 86+。');
      return;
    }
    try {
      const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
      const $dirName = $('#local-dir-name');
      if ($dirName) { $dirName.textContent = dirHandle.name; $dirName.hidden = false; }
      renderLocalSkeletons();
      const found = await scanDirectory(dirHandle);
      await addEntries(found.map(e => ({ name: e.name, handle: e.handle, blobUrl: null, file: null })));
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('[LocalLibrary] 打开文件夹失败:', error);
        alert(`打开文件夹失败：${error.message}`);
      }
    }
  });

  // 选择文件
  $('#local-open-file')?.addEventListener('click', async () => {
    if (!window.showOpenFilePicker) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.pdf,.epub,.mobi,.azw,.azw3';
      input.multiple = true;
      input.addEventListener('change', async () => {
        const newEntries = Array.from(input.files || [])
          .filter(f => SUPPORTED_EXTENSIONS.test(f.name))
          .map(f => ({ name: f.name, handle: null, blobUrl: URL.createObjectURL(f), file: f }));
        await addEntries(newEntries);
      });
      input.click();
      return;
    }
    try {
      const handles = await window.showOpenFilePicker({
        multiple: true,
        types: [{ description: '电子书文件', accept: {
          'application/pdf': ['.pdf'],
          'application/epub+zip': ['.epub'],
          'application/x-mobipocket-ebook': ['.mobi', '.azw', '.azw3']
        }}]
      });
      await addEntries(
        handles.filter(h => SUPPORTED_EXTENSIONS.test(h.name))
               .map(h => ({ name: h.name, handle: h, blobUrl: null, file: null }))
      );
    } catch (error) {
      if (error.name !== 'AbortError') console.error('[LocalLibrary] 打开文件失败:', error);
    }
  });

  // 清空全部
  $('#local-clear-all')?.addEventListener('click', async () => {
    if (!localBooks.length) return;
    if (!confirm(`确认从本地书库中移除全部 ${localBooks.length} 本书？\n（不会删除实际文件）`)) return;
    await clearAllLocalEntries();
  });

  // 清除阅读进度
  $('#local-clear-progress')?.addEventListener('click', () => {
    const count = localBooks.filter(b => getBookReadingStatus(b.key) !== 'unread' || getBookReadingProgress(b.key) > 0).length;
    if (!count) return;
    if (!confirm(`确认清除全部 ${count} 本本地书籍的阅读进度？`)) return;
    clearAllReadingStatus('__local__/');
    renderLocalList();
  });

  // 进度变化 → 局部更新
  window.addEventListener('bookreadingchange', ({ detail }) => {
    const key = detail?.file;
    if (key?.startsWith('__local__/')) {
      populateLocalFilterOptions();
      updateLocalBookProgress(key);
    }
  });
}

// ── 公开 API ──────────────────────────────────────────────────

export async function initLocalLibrary(onOpenBook) {
  openLocalBookHandler = onOpenBook;
  updateLocalViewUI();
  bindLocalControls();
  // 从 IndexedDB 恢复上次的书单
  await restoreFromIDB();
}

export function clearLocalActiveState() {
  currentLocalActiveFile = null;
  document.querySelectorAll('.local-book-item').forEach(el => el.classList.remove('active'));
}
