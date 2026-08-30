// 阅读状态与位置持久化
const STORAGE_KEY = 'bookReadingStatus';
const READ_STATUSES = new Set(['read', 'reading', 'finished']);
const LOCATION_KINDS = new Set(['pdf-page', 'epub-cfi']);

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

function notifyChange(file) {
  window.dispatchEvent(new CustomEvent('bookreadingchange', { detail: { file } }));
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
  if (
    current.status === next.status
    && Math.abs((current.progress || 0) - next.progress) < 0.01
    && JSON.stringify(current.location || null) === JSON.stringify(next.location || null)
  ) return;
  records[file] = next;
  saveRecords();
  if (current.status !== next.status) notifyChange(file);
}
