// 阅读状态持久化
const STORAGE_KEY = 'bookReadingStatus';

const clampProgress = (value) => Math.max(0, Math.min(1, Number(value) || 0));

function readRecords() {
  try {
    const records = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return records && typeof records === 'object' ? records : {};
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

export function markBookOpened(file) {
  const current = records[file] || {};
  const next = {
    status: 'reading',
    progress: clampProgress(current.progress),
    lastOpenedAt: Date.now()
  };
  records[file] = next;
  saveRecords();
  if (current.status !== next.status) notifyChange(file);
}

export function markBookFinished(file) {
  if (!file) return;
  const current = records[file] || {};
  const next = {
    status: 'finished',
    progress: 1,
    lastOpenedAt: current.lastOpenedAt || Date.now()
  };
  records[file] = next;
  saveRecords();
  if (current.status !== next.status) notifyChange(file);
}

export function updateBookProgress(file, progress) {
  if (!file || !Number.isFinite(Number(progress))) return;
  const normalizedProgress = clampProgress(progress);
  const current = records[file] || {};
  const next = {
    status: current.status === 'finished'
      ? 'finished'
      : normalizedProgress >= 1
        ? 'finished'
        : normalizedProgress > 0
          ? 'reading'
          : current.status || 'unread',
    progress: current.status === 'finished' ? 1 : normalizedProgress,
    lastOpenedAt: current.lastOpenedAt || Date.now()
  };
  if (
    current.status === next.status
    && Math.abs((current.progress || 0) - next.progress) < 0.01
  ) return;
  records[file] = next;
  saveRecords();
  if (current.status !== next.status) notifyChange(file);
}
