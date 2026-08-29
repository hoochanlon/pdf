// 书架目录、搜索与筛选
import { state } from './state.js';
import { $, bookListUrl, isEpub } from './utils.js';
import { getBookReadingStatus } from './reading.js';

const STATUS_OPTIONS = [
  { value: 'unread', label: '未读' },
  { value: 'reading', label: '阅读中' },
  { value: 'finished', label: '已读' }
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
  status: ''
};

let books = [];
let openBookHandler = null;
let controlsBound = false;

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
  const base = withoutExtension(filename);
  const quotedTitle = base.match(/^《([^》]+)》/);
  if (quotedTitle) return quotedTitle[1].trim();

  const separatorIndex = Math.max(base.lastIndexOf('-'), base.lastIndexOf('—'), base.lastIndexOf('–'));
  return separatorIndex > 0 ? base.slice(0, separatorIndex).trim() : base;
}

function inferAuthor(filename) {
  const base = withoutExtension(filename);
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

  return { file, title, author, format, language };
}

function languageLabel(value) {
  return LANGUAGE_OPTIONS.find((option) => option.value === value)?.label || '未识别';
}

function readingStatusLabel(value) {
  return STATUS_OPTIONS.find((option) => option.value === value)?.label || '未读';
}

function hasActiveFilters() {
  return Boolean(filters.query || filters.author || filters.format || filters.language || filters.status);
}

function matchesFilters(book) {
  const query = normalizeText(filters.query);
  const searchableText = normalizeText(`${book.title} ${book.author} ${book.file}`);

  return (!query || searchableText.includes(query))
    && (!filters.author || book.author === filters.author)
    && (!filters.format || book.format === filters.format)
    && (!filters.language || book.language === filters.language)
    && (!filters.status || getBookReadingStatus(book.file) === filters.status);
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
    filters.status
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

  books.forEach((book) => {
    authorCounts.set(book.author, (authorCounts.get(book.author) || 0) + 1);
    formatCounts.set(book.format, (formatCounts.get(book.format) || 0) + 1);
    if (book.language) languageCounts.set(book.language, (languageCounts.get(book.language) || 0) + 1);
    const readingStatus = getBookReadingStatus(book.file);
    statusCounts.set(readingStatus, (statusCounts.get(readingStatus) || 0) + 1);
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

  replaceOptions($('#book-author-filter'), authorOptions, '全部作者');
  replaceOptions($('#book-format-filter'), formatOptions, '全部格式');
  replaceOptions($('#book-language-filter'), languageOptions, '全部语言');
  replaceOptions($('#book-status-filter'), statusOptions, '全部状态');
}

function renderBookList() {
  const list = $('#book-list');
  const status = $('#library-state');
  const visibleBooks = books.filter(matchesFilters);
  const filtered = hasActiveFilters();

  $('#sidebar-count').textContent = visibleBooks.length;
  $('#library-reset').disabled = !filtered;
  updateFilterSummary();
  list.replaceChildren();

  if (!books.length) {
    status.textContent = 'uploads 中暂无 PDF 或 EPUB';
    return;
  }
  if (!visibleBooks.length) {
    status.textContent = '没有找到匹配的书籍';
    return;
  }

  status.textContent = filtered
    ? `显示 ${visibleBooks.length} / ${books.length} 本书`
    : '选择一本书开始阅读';

  visibleBooks.forEach((book) => {
    const item = document.createElement('li');
    const epub = isEpub(book.file);
    const readingStatus = getBookReadingStatus(book.file);
    const name = document.createElement('span');
    const meta = document.createElement('span');

    item.className = 'book-item';
    item.classList.toggle('active', state.activeFile === book.file);
    item.dataset.file = book.file;
    item.setAttribute('role', 'button');
    item.tabIndex = 0;
    item.title = book.file;
    item.innerHTML = `<span class="book-icon ${epub ? 'epub' : ''}">${epub ? 'EPUB' : 'PDF'}</span><span class="book-info"></span><span class="book-arrow">›</span>`;

    name.className = 'book-name';
    name.textContent = book.title;
    meta.className = 'book-meta';
    meta.textContent = `${book.author} · ${book.format} · ${languageLabel(book.language)} · ${readingStatusLabel(readingStatus)}`;
    item.querySelector('.book-info').append(name, meta);

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
    $('#book-search').value = '';
    $('#book-author-filter').value = '';
    $('#book-format-filter').value = '';
    $('#book-language-filter').value = '';
    $('#book-status-filter').value = '';
    renderBookList();
  });
  window.addEventListener('bookreadingchange', () => {
    populateFilterOptions();
    renderBookList();
  });
}

export async function loadBookList(onOpenBook) {
  const status = $('#library-state');
  openBookHandler = onOpenBook;
  bindControls();

  try {
    const response = await fetch(bookListUrl(), {
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const rawBooks = Array.isArray(payload) ? payload : payload.books;

    books = (Array.isArray(rawBooks) ? rawBooks : []).map(normalizeBook).filter(Boolean);
    $('#book-count').textContent = `${books.length} 本书`;
    populateFilterOptions();
    renderBookList();
  } catch (error) {
    console.error('加载书籍列表失败:', error);
    books = [];
    $('#book-count').textContent = '0 本书';
    $('#sidebar-count').textContent = '0';
    $('#book-list').replaceChildren();
    status.textContent = '书籍清单加载失败，请检查 books.json';
  }
}
