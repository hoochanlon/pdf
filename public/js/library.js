// 书架目录、搜索与筛选
import { state } from './state.js';
import { $, bookListUrl, isEpub, isMobi, ICON_BOOK, ICON_PAPER } from './utils.js';
import { getBookReadingStatus, getBookReadingProgress, getBookReadingLocation, clearBookReadingStatus, clearOnlineReadingStatus } from './reading.js';
import { getBookCover, preloadCovers } from './covers.js';
import { CustomSelect } from './select.js';
import { t, LANGUAGE_CHANGE_EVENT } from './i18n.js';

const filters = {
  query: '',
  author: '',
  format: '',
  type: '',
  category: ''
};

let books = [];
let openBookHandler = null;
let controlsBound = false;
let isBookListLoading = false;
let currentView = localStorage.getItem('library-view') || 'list'; // 'list' 或 'grid'

// 筛选器的 CustomSelect 实例
let csAuthor = null;
let csFormat = null;
let csType = null;
let csCategory = null;

function normalizeText(value) {
  return String(value ?? '').trim().toLocaleLowerCase();
}

// 图书/论文是内置的两种类型，翻译显示；自定义类型（用户在 books.json 里自行填写的）原样显示
function getTypeLabel(type) {
  if (type === '论文') return t('library.typePaper');
  if (type === '图书' || !type) return t('library.typeBook');
  return type;
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

function normalizeBook(rawBook) {
  const source = typeof rawBook === 'string' ? { file: rawBook } : (rawBook || {});
  const file = String(source.file ?? source.filename ?? source.name ?? source.path ?? '').trim();
  if (!file) return null;

  const format = String(source.format || inferFormat(file)).replace(/^\./, '').toUpperCase();
  const title = String(source.title || inferTitle(file)).trim();
  const author = String(source.author || inferAuthor(file) || '未知作者').trim();
  const type = String(source.type || '图书').trim();
  const category = String(source.category || '未分类').trim();

  return { file, title, author, format, type, category };
}

function formatReadingProgress(file) {
  const progress = getBookReadingProgress(file);
  const location = getBookReadingLocation(file);

  if (progress === 0 && !location) return '';

  const percentage = Math.round(progress * 100);

  // PDF 显示页码信息
  if (location && location.kind === 'pdf-page') {
    return t('reader.pageProgress', null, { page: location.value, percent: percentage });
  }

  // EPUB/MOBI 只显示百分比
  if (percentage > 0) {
    return `${percentage}%`;
  }

  return '';
}

function hasActiveFilters() {
  return Boolean(filters.query || filters.author || filters.format || filters.type || filters.category);
}

function matchesFilters(book) {
  const query = normalizeText(filters.query);
  const searchableText = normalizeText(`${book.title} ${book.author} ${book.file}`);

  return (!query || searchableText.includes(query))
    && (!filters.author || book.author === filters.author)
    && (!filters.format || book.format === filters.format)
    && (!filters.type || book.type === filters.type)
    && (!filters.category || book.category === filters.category);
}

function createOption(value, label, count) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = count === undefined ? label : `${label} (${count})`;
  return option;
}

function replaceOptions(csInstance, options, emptyLabel) {
  const currentValue = csInstance.getValue();
  const allOptions = [{ value: '', label: emptyLabel }, ...options.map(o => ({ value: o.value, label: o.textContent }))];
  csInstance.setOptions(allOptions);
  // setOptions 内部会保持旧值（若还存在），否则重置
  if (!allOptions.some(o => o.value === currentValue)) {
    csInstance.setValue('', true);
  }
}

function updateFilterSummary() {
  const activeCount = [
    filters.query,
    filters.author,
    filters.format,
    filters.type,
    filters.category
  ].filter(Boolean).length;
  const toggle = $('#library-filter-toggle');
  const count = $('#library-filter-count');
  count.textContent = activeCount;
  count.hidden = activeCount === 0;
  toggle.classList.toggle('is-active', activeCount > 0);
  toggle.setAttribute('aria-label', activeCount ? t('library.filterActive', null, { count: activeCount }) : t('library.filter'));
}

function populateFilterOptions() {
  const authorCounts = new Map();
  const formatCounts = new Map();
  const typeCounts = new Map();
  const categoryCounts = new Map();

  books.forEach((book) => {
    authorCounts.set(book.author, (authorCounts.get(book.author) || 0) + 1);
    formatCounts.set(book.format, (formatCounts.get(book.format) || 0) + 1);
    typeCounts.set(book.type, (typeCounts.get(book.type) || 0) + 1);
    categoryCounts.set(book.category, (categoryCounts.get(book.category) || 0) + 1);
  });

  const authorOptions = [...authorCounts.keys()]
    .sort((left, right) => left.localeCompare(right, 'zh-CN'))
    .map((author) => createOption(author, author, authorCounts.get(author)));
  const formatOptions = [...formatCounts.keys()]
    .sort()
    .map((format) => createOption(format, format, formatCounts.get(format)));
  const typeOptions = [...typeCounts.keys()]
    .sort((left, right) => left.localeCompare(right, 'zh-CN'))
    .map((type) => createOption(type, getTypeLabel(type), typeCounts.get(type)));
  const categoryOptions = [...categoryCounts.keys()]
    .sort((left, right) => left.localeCompare(right, 'zh-CN'))
    .map((category) => createOption(category, category, categoryCounts.get(category)));

  replaceOptions(csAuthor,   authorOptions,   t('library.allAuthors'));
  replaceOptions(csFormat,   formatOptions,   t('library.allFormats'));
  replaceOptions(csType,     typeOptions,     t('library.allTypes'));
  replaceOptions(csCategory, categoryOptions, t('library.allCategories'));
}

function updateEmptyState(title, message = '') {
  const emptyStateTitle = $('#empty-state-title');
  const emptyStateMessage = $('#empty-state-message');
  if (emptyStateTitle) emptyStateTitle.textContent = title;
  if (emptyStateMessage) emptyStateMessage.textContent = message;
}

function refreshEmptyStateForLanguage() {
  if (isBookListLoading && !books.length) {
    updateEmptyState(t('reader.loading'), '');
    return;
  }

  if (!books.length) {
    updateEmptyState(t('reader.libraryEmpty'), t('reader.libraryEmptyHint'));
    return;
  }

  if (!state.activeFile) {
    updateEmptyState(t('reader.selectBook'), '');
  }
}

function renderSkeletons(count = 5) {
  const list = $('#book-list');
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

function renderBookList() {
  const list = $('#book-list');
  const emptyState = $('#empty-state');
  const visibleBooks = books.filter(matchesFilters);
  const filtered = hasActiveFilters();

  $('#sidebar-count').textContent = visibleBooks.length;
  $('#library-reset').disabled = !filtered;
  updateFilterSummary();

  // 先淡出，再替换内容，消除闪烁
  list.classList.add('is-loading');
  list.replaceChildren();

  if (!books.length) {
    updateEmptyState(t('reader.libraryEmpty'), t('reader.libraryEmptyHint'));
    if (emptyState) emptyState.style.display = 'flex';
    requestAnimationFrame(() => list.classList.remove('is-loading'));
    return;
  }
  if (!visibleBooks.length) {
    updateEmptyState(t('reader.noMatch'), t('reader.noMatchHint'));
    if (emptyState) emptyState.style.display = 'flex';
    requestAnimationFrame(() => list.classList.remove('is-loading'));
    return;
  }

  // 有书籍显示且当前没有打开任何书时，更新 empty-state 为默认提示
  if (!state.activeFile) {
    updateEmptyState(t('reader.selectBook'), '');
  }

  visibleBooks.forEach((book) => {
    const item = document.createElement('li');
    const epub = isEpub(book.file);
    const mobi = isMobi(book.file);
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

      // 加载封面（预加载后缓存命中时直接显示，无闪烁）
      getBookCover(book.file).then(coverUrl => {
        if (coverUrl) {
          coverImage.onload = () => coverImage.classList.add('loaded');
          coverImage.src = coverUrl;
          // 图片已在浏览器缓存时 complete 立即为 true，onload 不会再触发
          if (coverImage.complete && coverImage.naturalWidth > 0) {
            coverImage.classList.add('loaded');
          }
        } else {
          cover.classList.add('no-cover');
        }
      }).catch(() => {
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

      footerInfo.appendChild(footerAuthor);

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

      // 网格视图：阅读状态清除按钮（悬停显示，右上角）
      const gridClearBtn = document.createElement('button');
      gridClearBtn.className = 'local-delete-btn book-clear-status-btn';
      gridClearBtn.type = 'button';
      gridClearBtn.setAttribute('aria-label', t('library.clearBookProgress', null, { title: book.title }));
      gridClearBtn.textContent = '↺';
      gridClearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        clearBookReadingStatus(book.file);
      });

      item.appendChild(formatBadge);
      item.appendChild(cover);
      item.appendChild(footer);
      item.appendChild(gridClearBtn);

    } else {
      // 列表视图：横向信息条样式，左侧显示封面缩略图
      const coverThumb = document.createElement('div');
      coverThumb.className = 'book-cover-thumb';

      const coverImage = document.createElement('img');
      coverImage.className = 'book-cover-thumb-image';
      coverImage.alt = book.title;

      // 加载封面（预加载后缓存命中时直接显示，无闪烁）
      getBookCover(book.file).then(coverUrl => {
        if (coverUrl) {
          coverImage.onload = () => coverImage.classList.add('loaded');
          coverImage.src = coverUrl;
          if (coverImage.complete && coverImage.naturalWidth > 0) {
            coverImage.classList.add('loaded');
          }
        } else {
          coverThumb.classList.add('no-cover');
        }
      }).catch(() => {
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

      // 第2行：作者 + 进度（同一行）
      const author = document.createElement('div');
      author.className = 'book-meta book-author-row';

      const authorText = document.createElement('span');
      authorText.className = 'book-author';
      authorText.textContent = book.author;
      author.appendChild(authorText);

      if (progressInfo) {
        const progressEl = document.createElement('span');
        progressEl.className = 'book-progress-info';
        progressEl.textContent = progressInfo;
        author.appendChild(progressEl);
      }

      // 第3行：类型徽章 + 分类徽章
      const category = document.createElement('div');
      category.className = 'book-meta book-category';

      const isPaper = book.type === '论文';
      const typeBadge = document.createElement('span');
      typeBadge.className = `type-badge ${isPaper ? 'type-paper' : 'type-book'}`;
      typeBadge.innerHTML = `${isPaper ? ICON_PAPER : ICON_BOOK}<span>${getTypeLabel(book.type)}</span>`;
      category.appendChild(typeBadge);

      const categoryBadge = document.createElement('span');
      categoryBadge.className = 'category-badge';
      categoryBadge.textContent = book.category;
      category.appendChild(categoryBadge);

      infoSpan.append(name, author, category);

      item.appendChild(coverThumb);
      item.appendChild(infoSpan);
      item.appendChild(arrowSpan);

      // 阅读状态清除按钮（悬停显示，右上角）
      const clearBtn = document.createElement('button');
      clearBtn.className = 'local-delete-btn book-clear-status-btn';
      clearBtn.type = 'button';
      clearBtn.setAttribute('aria-label', t('library.clearBookProgress', null, { title: book.title }));
      clearBtn.textContent = '↺';
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        clearBookReadingStatus(book.file);
      });
      item.appendChild(clearBtn);
    }

    item.addEventListener('click', () => openBookHandler(book.file, item));
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openBookHandler(book.file, item);
      }
    });
    // 动画完成后标记，防止重排时重复播放
    item.addEventListener('animationend', () => item.classList.add('entered'), { once: true });
    list.appendChild(item);
  });

  // 内容填充完毕，移除 is-loading 触发淡入
  requestAnimationFrame(() => {
    list.classList.remove('is-loading');
  });
}

function bindControls() {
  if (controlsBound) return;
  controlsBound = true;

  // 初始化筛选器 CustomSelect
  const makeFilterSelect = (wrapId, onChangeFn) => {
    const wrap = $(`#${wrapId}`);
    return new CustomSelect(
      wrap.querySelector('.cs-trigger'),
      wrap.querySelector('.cs-listbox'),
      { onChange: (v) => { onChangeFn(v); renderBookList(); } }
    );
  };

  csAuthor   = makeFilterSelect('cs-author-wrap',   (v) => { filters.author   = v; });
  csFormat   = makeFilterSelect('cs-format-wrap',   (v) => { filters.format   = v; });
  csType     = makeFilterSelect('cs-type-wrap',     (v) => { filters.type     = v; });
  csCategory = makeFilterSelect('cs-category-wrap', (v) => { filters.category = v; });

  // 初始填充空选项（等 populateFilterOptions 后会被替换）
  [
    [csAuthor,   t('library.allAuthors')],
    [csFormat,   t('library.allFormats')],
    [csType,     t('library.allTypes')],
    [csCategory, t('library.allCategories')],
  ].forEach(([cs, label]) => cs.setOptions([{ value: '', label }]));

  $('#book-search').addEventListener('input', (event) => {
    filters.query = event.target.value;
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
    filters.type = '';
    filters.category = '';
    $('#book-search').value = '';
    csAuthor.setValue('',   true);
    csFormat.setValue('',   true);
    csType.setValue('',     true);
    csCategory.setValue('', true);
    renderBookList();
  });
  $('#library-view-toggle').addEventListener('click', () => {
    currentView = currentView === 'list' ? 'grid' : 'list';
    localStorage.setItem('library-view', currentView);
    updateViewUI();
    renderBookList();
  });
  $('#library-clear-progress')?.addEventListener('click', () => {
    // 统计有阅读记录的网络书数量（不含 __local__ 前缀）
    const count = books.filter(b => getBookReadingStatus(b.file) !== 'unread' || getBookReadingProgress(b.file) > 0).length;
    if (!count) return;
    if (!confirm(t('dialogs.clearOnlineProgress', null, { count }))) return;
    clearOnlineReadingStatus();
    renderBookList();
  });
  window.addEventListener('bookreadingchange', ({ detail }) => {
    // 1. 刷新筛选器中阅读状态的计数（状态变了计数就变了）
    populateFilterOptions();

    // 2. 局部更新对应书籍条目的进度，避免全量重渲染
    const file = detail?.file || state.activeFile;
    if (file) updateBookProgress(file);
  });

  // 切换语言后，重新生成筛选器选项文案、书籍卡片上的类型徽章、空状态文案（这些都是纯 JS 渲染，不会被 data-i18n 自动更新）
  window.addEventListener(LANGUAGE_CHANGE_EVENT, () => {
    try {
      refreshEmptyStateForLanguage();
      populateFilterOptions();
      renderBookList(); // 内部会重新调用 updateFilterSummary()
    } catch (error) {
      console.error('[library] 切换语言后刷新书架失败:', error);
    }
  });
}

// 局部更新指定书籍条目的进度显示，避免全量重渲染
function updateBookProgress(file) {
  const item = document.querySelector(`.book-item[data-file="${CSS.escape(file)}"]`);
  if (!item) return;

  const progress = getBookReadingProgress(file);
  const progressInfo = formatReadingProgress(file);

  // 网格视图：更新进度条和文字
  const progressBar = item.querySelector('.book-progress-bar');
  if (progressBar) {
    progressBar.style.width = `${progress * 100}%`;
  }
  const progressText = item.querySelector('.book-progress-text');
  if (progressText) {
    if (progressInfo) {
      progressText.textContent = progressInfo;
    } else {
      progressText.remove();
    }
  }

  // 列表视图：更新进度文字
  const progressInfoEl = item.querySelector('.book-progress-info');
  if (progressInfoEl) {
    if (progressInfo) {
      progressInfoEl.textContent = progressInfo;
    } else {
      progressInfoEl.remove();
    }
  } else if (progressInfo) {
    // 首次有进度时动态插入到作者行
    const authorRow = item.querySelector('.book-author-row');
    if (authorRow) {
      const progressEl = document.createElement('span');
      progressEl.className = 'book-progress-info';
      progressEl.textContent = progressInfo;
      authorRow.appendChild(progressEl);
    }
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
  isBookListLoading = true;
  updateEmptyState(t('reader.loading'), '');
  openBookHandler = onOpenBook;
  bindControls();
  updateViewUI(); // 初始化视图UI
  renderSkeletons(5); // 显示骨架屏，避免空列表闪烁

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
        type: book.type,
        category: book.category
      };
    });

    updateBookCount(books.length);
    populateFilterOptions();

    // 先预加载所有封面，图片就绪后再渲染列表，避免「背景色→封面图」的闪烁
    if (books.length > 0) {
      const bookFiles = books.map(b => b.file);
      await preloadCovers(bookFiles).catch(() => {}); // 失败不阻塞
    }

    console.log('[loadBookList] 封面预加载完成，开始渲染');
    renderBookList();
    console.log('[loadBookList] 完成');
    isBookListLoading = false;
    renderBookList();
    refreshEmptyStateForLanguage();
  } catch (error) {
    console.error('加载书籍列表失败:', error);
    books = [];
    isBookListLoading = false;
    updateBookCount(0);
    $('#sidebar-count').textContent = '0';
    $('#book-list').replaceChildren();
    updateEmptyState(t('reader.loadFailed'), t('reader.loadFailedHint'));
  }
}
