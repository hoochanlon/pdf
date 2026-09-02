// 阅读状态与位置持久化
const STORAGE_KEY = 'bookReadingStatus';
const READ_STATUSES = new Set(['read', 'reading', 'finished']);
const LOCATION_KINDS = new Set(['pdf-page', 'epub-cfi', 'mobi-cfi']);

const clampProgress = (value) => Math.max(0, Math.min(1, Number(value) || 0));

function normalizeLocation(location) {
  if (!location || typeof location !== 'object' || !LOCATION_KINDS.has(location.kind)) return null;
  if (location.kind === 'pdf-page') {
    const page = Number(location.value);
    return Number.isInteger(page) && page > 0 ? { kind: location.kind, value: page } : null;
  }
  return typeof location.value === 'string' && location.value ? { kind: location.kind, value: location.value } : null;
}

function normalizeRecord(record) {
  const source = record && typeof record === 'object' ? record : {};
  return {
    ...source,
    status: READ_STATUSES.has(source.status) ? 'read' : 'unread',
    progress: clampProgress(source.progress),
    location: normalizeLocation(source.location),
    lastOpenedAt: Number.isFinite(Number(source.lastOpenedAt)) ? Number(source.lastOpenedAt) : undefined
  };
}

function readRecords() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const normalized = Object.fromEntries(
      Object.entries(parsed).map(([file, record]) => [file, normalizeRecord(record)])
    );
    const migrated = JSON.stringify(parsed) !== JSON.stringify(normalized);
    if (migrated) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      } catch (error) {
        console.warn('迁移阅读状态失败:', error);
      }
    }
    return normalized;
  } catch (error) {
    console.warn('读取阅读状态失败:', error);
    return {};
  }
}

let records = readRecords();

function saveRecords() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch (error) {
    console.warn('保存阅读状态失败:', error);
  }
}

function notifyChange(file, extra = {}) {
  window.dispatchEvent(new CustomEvent('bookreadingchange', { detail: { file, ...extra } }));
}

export function getBookReadingStatus(file) {
  return records[file]?.status || 'unread';
}

export function getBookReadingProgress(file) {
  return records[file]?.progress || 0;
}

export function getBookReadingLocation(file) {
  return records[file]?.location || null;
}

export function markBookOpened(file) {
  if (!file) return;
  const current = records[file] || {};
  const next = {
    ...current,
    status: 'read',
    progress: clampProgress(current.progress),
    location: normalizeLocation(current.location),
    lastOpenedAt: Date.now()
  };
  records[file] = next;
  saveRecords();
  if (current.status !== next.status) notifyChange(file);
}

export function updateBookProgress(file, progress, location) {
  if (!file || !Number.isFinite(Number(progress))) return;
  const normalizedProgress = clampProgress(progress);
  const current = records[file] || {};
  const next = {
    ...current,
    status: READ_STATUSES.has(current.status) ? 'read' : 'unread',
    progress: normalizedProgress,
    location: location === undefined ? normalizeLocation(current.location) : normalizeLocation(location),
    lastOpenedAt: current.lastOpenedAt || Date.now()
  };
  
  // 检查是否有实质性变化
  const hasSignificantChange = 
    current.status !== next.status ||
    Math.abs((current.progress || 0) - next.progress) >= 0.01 ||
    JSON.stringify(current.location || null) !== JSON.stringify(next.location || null);
  
  // 总是保存
  records[file] = next;
  saveRecords();
  
  // 只在有实质性变化时通知
  if (hasSignificantChange) {
    notifyChange(file);
  }
}

export function clearBookReadingStatus(file) {
  if (!file || !records[file]) return;
  delete records[file];
  saveRecords();
  notifyChange(file, { cleared: true });
}

export function clearAllReadingStatus(prefix = '') {
  // prefix 为空时清除全部；传 '__local__/' 只清本地书库
  const keys = Object.keys(records).filter(k => prefix ? k.startsWith(prefix) : true);
  if (!keys.length) return;
  keys.forEach(k => delete records[k]);
  saveRecords();
  keys.forEach(k => notifyChange(k, { cleared: true }));
}

export function clearOnlineReadingStatus() {
  // 只清除网络书库的记录（不含 __local__/ 前缀）
  const keys = Object.keys(records).filter(k => !k.startsWith('__local__/'));
  if (!keys.length) return;
  keys.forEach(k => delete records[k]);
  saveRecords();
  keys.forEach(k => notifyChange(k, { cleared: true }));
}

export function hasAnyReadingStatus(prefix = '') {
  // 判断是否有任何阅读记录；prefix 为空时判断全部，传前缀只判断匹配的
  return Object.keys(records).some(k => prefix ? k.startsWith(prefix) : !k.startsWith('__local__/'));
}
