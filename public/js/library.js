// 书架目录、搜索与筛选
import { state } from './state.js';
import { $, bookListUrl, isEpub, isMobi } from './utils.js';
import { getBookReadingStatus, getBookReadingProgress, getBookReadingLocation } from './reading.js';
import { getBookCover, preloadCovers } from './covers.js';

const STATUS_OPTIONS = [
  { value: 'unread', label: '未读' },
  { value: 'read', label: '已读' }
];

const LANGUAGE_OPTIONS = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: '英文' },
  { value: 'ja', label: '日语' }
];

const filters = {
  query: '',
  author: '',
  format: '',
  language: '',
  status: '',
  category: ''
};

let books = [];
let openBookHandler = null;
let controlsBound = false;
let currentView = localStorage.getItem('library-view') || 'list'; // 'list' 或 'grid'

function normalizeText(value) {
  return String(value ?? '').trim().toLocaleLowerCase();
}

function withoutExtension(filename) {
  return filename.replace(/\.[^.]+$/, '');
}

function inferFormat(filename) {
  return filename.match(/\.([^.]+)$/)?.[1].toUpperCase() || '';
}

function inferTitle(filename) {
  // 如果是路径，只取文件名部分
  const basename = filename.split('/').pop();
  const base = withoutExtension(basename);
  const quotedTitle = base.match(/^《([^》]+)》/);
  if (quotedTitle) return quotedTitle[1].trim();

  const separatorIndex = Math.max(base.lastIndexOf('-'), base.lastIndexOf('—'), base.lastIndexOf('–'));
  return separatorIndex > 0 ? base.slice(0, separatorIndex).trim() : base;
}

function inferAuthor(filename) {
  // 如果是路径，只取文件名部分
  const basename = filename.split('/').pop();
  const base = withoutExtension(basename);
  const quotedTitle = base.match(/^《[^》]+》(.+)$/);
  if (quotedTitle) return quotedTitle[1].replace(/^[\s:：,，]+/, '').trim();

  const separatorIndex = Math.max(base.lastIndexOf('-'), base.lastIndexOf('—'), base.lastIndexOf('–'));
  return separatorIndex > 0 ? base.slice(separatorIndex + 1).trim() : '';
}

function normalizeLanguage(value, text) {
  const explicit = normalizeText(value);
  if (/^(zh|zh-cn|chinese|中文|简体中文|繁体中文)$/.test(explicit)) return 'zh';
  if (/^(en|en-us|english|英文)$/.test(explicit)) return 'en';
  if (/^(ja|ja-jp|japanese|日语|日本語)$/.test(explicit)) return 'ja';

  // 当前清单只有文件名；优先识别日文假名，再区分汉字和拉丁字母。
  if (/[\u3040-\u30ff]/u.test(text)) return 'ja';
  if (/[\u4e00-\u9fff]/u.test(text)) return 'zh';
  if (/[a-z]/i.test(text)) return 'en';
  return '';
}

function normalizeBook(rawBook) {
  const source = typeof rawBook === 'string' ? { file: rawBook } : (rawBook || {});
  const file = String(source.file ?? source.filename ?? source.name ?? source.path ?? '').trim();
  if (!file) return null;

  const format = String(source.format || inferFormat(file)).replace(/^\./, '').toUpperCase();
  const title = String(source.title || inferTitle(file)).trim();
  const author = String(source.author || inferAuthor(file) || '未知作者').trim();
  const language = normalizeLanguage(source.language || source.lang, title);
  const category = String(source.category || '未分类').trim();

  return { file, title, author, format, language, category };
}

function languageLabel(value) {
  return LANGUAGE_OPTIONS.find((option) => option.value === value)?.label || '未识别';
}

function readingStatusLabel(value) {
  return STATUS_OPTIONS.find((option) => option.value === value)?.label || '未读';
}

function formatReadingProgress(file) {
  const progress = getBookReadingProgress(file);
  const location = getBookReadingLocation(file);

  if (progress === 0 && !location) return '';

  const percentage = Math.round(progress * 100);

  // PDF 显示页码信息
  if (location && location.kind === 'pdf-page') {
    return `第${location.value}页 (${percentage}%)`;
  }

  // EPUB/MOBI 只显示百分比
  if (percentage > 0) {
    return `${percentage}%`;
  }

  return '';
}

function hasActiveFilters() {
  return Boolean(filters.query || filters.author || filters.format || filters.language || filters.status || filters.category);
}

function matchesFilters(book) {
  const query = normalizeText(filters.query);
  const searchableText = normalizeText(`${book.title} ${book.author} ${book.file}`);

  return (!query || searchableText.includes(query))
    && (!filters.author || book.author === filters.author)
    && (!filters.format || book.format === filters.format)
    && (!filters.language || book.language === filters.language)
    && (!filters.status || getBookReadingStatus(book.file) === filters.status)
    && (!filters.category || book.category === filters.category);
}

function createOption(value, label, count) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = count === undefined ? label : `${label} (${count})`;
  return option;
}

function replaceOptions(select, options, emptyLabel) {
  const selectedValue = select.value;
  select.replaceChildren(createOption('', emptyLabel));
  options.forEach((option) => select.appendChild(option));
  select.value = options.some((option) => option.value === selectedValue) ? selectedValue : '';
}

function updateFilterSummary() {
  const activeCount = [
    filters.query,
    filters.author,
    filters.format,
    filters.language,
    filters.status,
    filters.category
  ].filter(Boolean).length;
  const toggle = $('#library-filter-toggle');
  const count = $('#library-filter-count');
  count.textContent = activeCount;
  count.hidden = activeCount === 0;
  toggle.classList.toggle('is-active', activeCount > 0);
  toggle.setAttribute('aria-label', activeCount ? `筛选，${activeCount}项已启用` : '筛选');
}

function populateFilterOptions() {
  const authorCounts = new Map();
  const formatCounts = new Map();
  const languageCounts = new Map();
  const statusCounts = new Map();
  const categoryCounts = new Map();

  books.forEach((book) => {
    authorCounts.set(book.author, (authorCounts.get(book.author) || 0) + 1);
    formatCounts.set(book.format, (formatCounts.get(book.format) || 0) + 1);
    if (book.language) languageCounts.set(book.language, (languageCounts.get(book.language) || 0) + 1);
    const readingStatus = getBookReadingStatus(book.file);
    statusCounts.set(readingStatus, (statusCounts.get(readingStatus) || 0) + 1);
    categoryCounts.set(book.category, (categoryCounts.get(book.category) || 0) + 1);
  });

  const authorOptions = [...authorCounts.keys()]
    .sort((left, right) => left.localeCompare(right, 'zh-CN'))
    .map((author) => createOption(author, author, authorCounts.get(author)));
  const formatOptions = [...formatCounts.keys()]
    .sort()
    .map((format) => createOption(format, format, formatCounts.get(format)));
  const languageOptions = LANGUAGE_OPTIONS.map((language) => createOption(
    language.value,
    language.label,
    languageCounts.get(language.value) || 0
  ));
  const statusOptions = STATUS_OPTIONS.map((status) => createOption(
    status.value,
    status.label,
    statusCounts.get(status.value) || 0
  ));
  const categoryOptions = [...categoryCounts.keys()]
    .sort((left, right) => left.localeCompare(right, 'zh-CN'))
    .map((category) => createOption(category, category, categoryCounts.get(category)));

  replaceOptions($('#book-author-filter'), authorOptions, '全部作者');
  replaceOptions($('#book-format-filter'), formatOptions, '全部格式');
  replaceOptions($('#book-language-filter'), languageOptions, '全部语言');
  replaceOptions($('#book-status-filter'), statusOptions, '全部状态');
  replaceOptions($('#book-category-filter'), categoryOptions, '全部分类');
}

function updateEmptyState(title, message = '') {
  const emptyStateTitle = $('#empty-state-title');
  const emptyStateMessage = $('#empty-state-message');
  if (emptyStateTitle) emptyStateTitle.textContent = title;
  if (emptyStateMessage) emptyStateMessage.textContent = message;
}

function renderBookList() {
  const list = $('#book-list');
  const emptyState = $('#empty-state');
  const visibleBooks = books.filter(matchesFilters);
  const filtered = hasActiveFilters();

  $('#sidebar-count').textContent = visibleBooks.length;
  $('#library-reset').disabled = !filtered;
  updateFilterSummary();
  list.replaceChildren();

  if (!books.length) {
    updateEmptyState('书架空空如也', '请添加书籍到 books.json');
    if (emptyState) emptyState.style.display = 'flex';
    return;
  }
  if (!visibleBooks.length) {
    updateEmptyState('未找到匹配的书籍', '试试调整筛选条件');
    if (emptyState) emptyState.style.display = 'flex';
    return;
  }

  // 有书籍显示时，更新empty-state为默认提示
  if (!state.currentBook) {
    updateEmptyState('选择一本书开始阅读', '');
  }

  visibleBooks.forEach((book) => {
    const item = document.createElement('li');
    const epub = isEpub(book.file);
    const mobi = isMobi(book.file);
    const readingStatus = getBookReadingStatus(book.file);
    const progressInfo = formatReadingProgress(book.file);
    const progress = getBookReadingProgress(book.file);

    item.className = 'book-item';
    if (epub) item.classList.add('epub-book');
    if (mobi) item.classList.add('mobi-book');
    item.classList.toggle('active', state.activeFile === book.file);
    item.dataset.file = book.file;
    item.setAttribute('role', 'button');
    item.tabIndex = 0;
    
    if (currentView === 'grid') {
      // 网格视图：封面卡片样式
      const formatBadge = document.createElement('span');
      formatBadge.className = 'book-format-badge';
      formatBadge.textContent = book.format;
      
      const cover = document.createElement('div');
      cover.className = 'book-cover';
      
      // 添加封面图片
      const coverImage = document.createElement('img');
      coverImage.className = 'book-cover-image';
      coverImage.alt = book.title;
      
      // 异步加载封面
      getBookCover(book.file).then(coverUrl => {
        if (coverUrl) {
          coverImage.src = coverUrl;
          coverImage.style.display = 'block';
        } else {
          // 没有封面时，显示默认样式（纯色背景 + 书名）
          cover.classList.add('no-cover');
        }
      }).catch(err => {
        console.error('加载封面失败:', err);
        cover.classList.add('no-cover');
      });
      
      const coverTitle = document.createElement('div');
      coverTitle.className = 'book-cover-title';
      coverTitle.textContent = book.title;
      
      cover.appendChild(coverImage);
      cover.appendChild(coverTitle);
      
      const footer = document.createElement('div');
      footer.className = 'book-footer';
      
      const footerInfo = document.createElement('div');
      footerInfo.className = 'book-footer-info';
      
      const footerAuthor = document.createElement('span');
      footerAuthor.className = 'book-footer-author';
      footerAuthor.textContent = book.author;
      
      const footerMeta = document.createElement('span');
      footerMeta.className = 'book-footer-meta';
      footerMeta.textContent = languageLabel(book.language);
      
      footerInfo.appendChild(footerAuthor);
      footerInfo.appendChild(footerMeta);
      
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
      
      footer.appendChild(footerInfo);
      footer.appendChild(progressWrap);
      
      item.appendChild(formatBadge);
      item.appendChild(cover);
      item.appendChild(footer);
      
    } else {
      // 列表视图：横向信息条样式，左侧显示封面缩略图
      const coverThumb = document.createElement('div');
      coverThumb.className = 'book-cover-thumb';
      
      const coverImage = document.createElement('img');
      coverImage.className = 'book-cover-thumb-image';
      coverImage.alt = book.title;
      
      // 异步加载封面
      getBookCover(book.file).then(coverUrl => {
        if (coverUrl) {
          coverImage.src = coverUrl;
          coverImage.style.display = 'block';
        } else {
          // 没有封面时，显示默认样式
          coverThumb.classList.add('no-cover');
        }
      }).catch(err => {
        console.error('加载封面失败:', err);
        coverThumb.classList.add('no-cover');
      });
      
      const formatBadge = document.createElement('span');
      formatBadge.className = 'book-cover-thumb-badge';
      formatBadge.textContent = book.format;
      
      coverThumb.appendChild(coverImage);
      coverThumb.appendChild(formatBadge);
      
      const infoSpan = document.createElement('span');
      infoSpan.className = 'book-info';
      
      const arrowSpan = document.createElement('span');
      arrowSpan.className = 'book-arrow';
      arrowSpan.textContent = '›';
      
      // 第1行：书名（最多2行）
      const name = document.createElement('div');
      name.className = 'book-name';
      name.textContent = book.title;
      
      // 第2行：作者
      const author = document.createElement('div');
      author.className = 'book-meta book-author';
      author.textContent = book.author;
      
      // 第3行：分类徽章
      const category = document.createElement('div');
      category.className = 'book-meta book-category';
      const categoryBadge = document.createElement('span');
      categoryBadge.className = 'category-badge';
      categoryBadge.textContent = book.category;
      category.appendChild(categoryBadge);
      
      infoSpan.append(name, author, category);
      
      item.appendChild(coverThumb);
      item.appendChild(infoSpan);
      item.appendChild(arrowSpan);
    }

    item.addEventListener('click', () => openBookHandler(book.file, item));
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openBookHandler(book.file, item);
      }
    });
    list.appendChild(item);
  });
}

function bindControls() {
  if (controlsBound) return;
  controlsBound = true;

  $('#book-search').addEventListener('input', (event) => {
    filters.query = event.target.value;
    renderBookList();
  });
  $('#book-author-filter').addEventListener('change', (event) => {
    filters.author = event.target.value;
    renderBookList();
  });
  $('#book-format-filter').addEventListener('change', (event) => {
    filters.format = event.target.value;
    renderBookList();
  });
  $('#book-language-filter').addEventListener('change', (event) => {
    filters.language = event.target.value;
    renderBookList();
  });
  $('#book-status-filter').addEventListener('change', (event) => {
    filters.status = event.target.value;
    renderBookList();
  });
  $('#book-category-filter').addEventListener('change', (event) => {
    filters.category = event.target.value;
    renderBookList();
  });
  $('#library-filter-toggle').addEventListener('click', () => {
    const toggle = $('#library-filter-toggle');
    const panel = $('#library-filter-panel');
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    panel.hidden = expanded;
  });
  $('#library-reset').addEventListener('click', () => {
    filters.query = '';
    filters.author = '';
    filters.format = '';
    filters.language = '';
    filters.status = '';
    filters.category = '';
    $('#book-search').value = '';
    $('#book-author-filter').value = '';
    $('#book-format-filter').value = '';
    $('#book-language-filter').value = '';
    $('#book-status-filter').value = '';
    $('#book-category-filter').value = '';
    renderBookList();
  });
  $('#library-view-toggle').addEventListener('click', () => {
    currentView = currentView === 'list' ? 'grid' : 'list';
    localStorage.setItem('library-view', currentView);
    updateViewUI();
    renderBookList();
  });
  window.addEventListener('bookreadingchange', () => {
    // 只更新当前打开书籍的进度显示，避免整个列表重新渲染
    updateActiveBookProgress();
  });
}

// 只更新当前激活书籍的进度信息，避免全量刷新
function updateActiveBookProgress() {
  if (!state.activeFile) return;
  
  const activeItem = document.querySelector(`.book-item[data-file="${state.activeFile}"]`);
  if (!activeItem) return;
  
  const book = books.find(b => b.file === state.activeFile);
  if (!book) return;
  
  const progressInfo = formatReadingProgress(state.activeFile);
  const metaEl = activeItem.querySelector('.book-meta');
  
  if (metaEl && currentView === 'list') {
    // 列表视图：更新元信息文本
    const readingStatus = getBookReadingStatus(state.activeFile);
    const metaParts = [
      book.author,
      book.format,
      languageLabel(book.language),
      readingStatusLabel(readingStatus)
    ];
    if (progressInfo) {
      metaParts.push(progressInfo);
    }
    metaEl.textContent = metaParts.join(' · ');
  }
  
  // 网格视图：更新进度条
  const progressBar = activeItem.querySelector('.book-progress-bar');
  const progressText = activeItem.querySelector('.book-progress-text');
  
  if (progressBar) {
    const progress = getBookReadingProgress(state.activeFile);
    progressBar.style.width = `${progress * 100}%`;
  }
  
  if (progressText && progressInfo) {
    progressText.textContent = progressInfo;
  }
}

function updateBookCount(count) {
  const bookCountEl = $('#book-count');
  if (bookCountEl) {
    bookCountEl.textContent = `${count} 本书`;
  }
}

function updateViewUI() {
  const bookList = $('#book-list');
  const viewIcon = $('#view-icon');
  
  if (currentView === 'grid') {
    bookList.classList.remove('view-list');
    bookList.classList.add('view-grid');
    viewIcon.textContent = '☰';
  } else {
    bookList.classList.remove('view-grid');
    bookList.classList.add('view-list');
    viewIcon.textContent = '⊞';
  }
}

export async function loadBookList(onOpenBook) {
  console.log('[loadBookList] 开始执行');
  updateEmptyState('正在加载书籍列表…', '');
  openBookHandler = onOpenBook;
  bindControls();
  updateViewUI(); // 初始化视图UI

  try {
    console.log('[loadBookList] 开始 fetch');
    const response = await fetch(bookListUrl(), {
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });
    console.log('[loadBookList] fetch 完成, status:', response.status);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const rawBooks = Array.isArray(payload) ? payload : payload.books;
    console.log('[loadBookList] rawBooks 数量:', Array.isArray(rawBooks) ? rawBooks.length : '非数组');

    books = (Array.isArray(rawBooks) ? rawBooks : []).map(normalizeBook).filter(Boolean);
    console.log('[loadBookList] books 数量:', books.length);
    
    // 保存元数据到全局状态，供阅读器使用
    state.booksMetadata = {};
    books.forEach(book => {
      state.booksMetadata[book.file] = {
        title: book.title,
        author: book.author,
        category: book.category
      };
    });
    
    updateBookCount(books.length);
    console.log('[loadBookList] 开始 populateFilterOptions');
    populateFilterOptions();
    console.log('[loadBookList] 开始 renderBookList');
    renderBookList();
    console.log('[loadBookList] 完成');
    
    // 后台预加载封面
    if (books.length > 0) {
      const bookFiles = books.map(b => b.file);
      preloadCovers(bookFiles).catch(err => {
        console.warn('预加载封面失败:', err);
      });
    }
  } catch (error) {
    console.error('加载书籍列表失败:', error);
    books = [];
    updateBookCount(0);
    $('#sidebar-count').textContent = '0';
    $('#book-list').replaceChildren();
    updateEmptyState('加载失败', '无法读取 books.json，请检查文件是否存在');
  }
}
