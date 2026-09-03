// EPUB 目录（TOC）模块
// 职责：
//   1) 读取 book.loaded.navigation 并渲染到 epub-toc-list（抽屉目录）
//   2) 同步到 state.epubChapters（供章节跳转/上一章下一章用）
//
// 注意：不直接碰 UI 以外的进度/导航逻辑；章节跳转只通过 state.rendition.display()。
import { state } from './state.js';
import { $ } from './utils.js';
import { t } from './i18n.js';
import { getEPUBSpineIndex, updateEPUBChapterControls, updateEPUBLocation } from './epub-progress.js?v=16';
import { toggleTOC } from './epub.js?v=16';

/**
 * 异步加载 EPUB 目录，并写入 #epub-toc-list。
 * 与 renderEPUB 里提供的 requestId / renderToken 保持一致校验，避免旧书异步回来污染新书。
 */
export async function loadEPUBTOC(book, requestId, renderToken) {
  const list = $('#epub-toc-list');
  list.replaceChildren();
  const navigation = await waitForStage(book.loaded.navigation, 'reader.stageLoadToc', 10000);
  if (requestId !== state.requestId || renderToken !== state.epubRenderToken) return;
  const items = navigation?.toc || [];
  const chapters = [];
  const isCurrentTOC = () => (
    requestId === state.requestId
    && renderToken === state.epubRenderToken
    && state.book === book
    && state.rendition
  );
  if (!items.length) {
    state.epubChapters = [];
    const empty = document.createElement('li');
    empty.className = 'pdf-outline-empty';
    empty.textContent = t('reader.epubNoOutline');
    list.appendChild(empty);
    updateEPUBChapterControls();
    return;
  }
  const appendItems = (entries, parent, level = 0) => entries.forEach((entry) => {
    const chapter = {
      href: entry.href,
      label: entry.label?.trim() || t('reader.untitledChapter'),
      level,
      spineIndex: getEPUBSpineIndex(book, entry.href, chapters.length),
    };
    chapters.push(chapter);
    const item = document.createElement('li');
    const button = document.createElement('button');
    item.className = 'pdf-outline-item';
    button.type = 'button';
    button.textContent = chapter.label;
    button.style.paddingLeft = `${12 + level * 14}px`;
    button.addEventListener('click', () => {
      if (!isCurrentTOC()) return;
      const rendition = state.rendition;
      void rendition.display(chapter.href).catch((error) => {
        if (isCurrentTOC()) console.warn('EPUB 目录跳转失败:', error);
      });
      toggleTOC(false);
    });
    item.appendChild(button);
    parent.appendChild(item);
    if (entry.subitems?.length) appendItems(entry.subitems, parent, level + 1);
  });
  appendItems(items, list);
  state.epubChapters = chapters;
  updateEPUBChapterControls();
  const current = state.rendition?.currentLocation?.();
  if (current?.then) void current.then(updateEPUBLocation);
  else if (current) updateEPUBLocation(current);
}

// 将 waitForStage 挂到 window 上 — 但此模块不直接依赖全局，而是复用 epub.js 的包装函数。
// 为了避免与全局命名冲突，这里提供一个独立的实现（逻辑与 epub.js 等价）。
async function waitForStage(promiseOrThenable, stage, timeoutMs = 15000) {
  const state = window.__READER_STATE__ || {};
  // 兼容：当 stage 是字符串时，报告给 reader 状态栏。
  if (typeof stage === 'string' && typeof state.setStage === 'function') state.setStage(stage);
  try {
    return await Promise.race([
      Promise.resolve(promiseOrThenable),
      new Promise((_, reject) => window.setTimeout(
        () => reject(new Error(`EPUB 阶段超时: ${stage}`)),
        timeoutMs,
      )),
    ]);
  } finally {
    if (typeof stage === 'string' && typeof state.clearStage === 'function') state.clearStage(stage);
  }
}
