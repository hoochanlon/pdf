// MOBI 渲染模块 - 使用 foliate-js
import { state } from './state.js';
import { $ } from './utils.js';
import { updateBookProgress, markBookOpened, getBookReadingProgress } from './reading.js';
import { t } from './i18n.js';

let mobiView = null;
let foliateLoaded = false;

async function loadFoliateJS() {
  if (foliateLoaded) return;
  
  try {
    console.log('[MOBI] 开始加载 foliate-js...');
    // 从本地路径加载 foliate-js（使用相对路径以兼容子路径部署）
    await import('../lib/foliate-js/view.js');
    foliateLoaded = true;
    console.log('[MOBI] foliate-js 加载成功');
  } catch (error) {
    console.error('[MOBI] foliate-js 加载失败:', error);
    throw new Error(t('reader.mobiLibraryLoadFailed', null, { message: error.message }));
  }
}

async function waitForLibrary(timeout = 10000) {
  const startedAt = Date.now();
  while (typeof customElements.get('foliate-view') === 'undefined') {
    if (Date.now() - startedAt >= timeout) {
      throw new Error(t('reader.mobiLibraryInitTimeout'));
    }
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  console.log('[MOBI] foliate-view 元素已注册');
}

function setMobiStatus(title, detail = '', isError = false) {
  const panel = $('#mobi-status');
  panel.classList.toggle('is-hidden', false);
  panel.classList.toggle('is-error', isError);
  $('#mobi-status-title').textContent = title;
  $('#mobi-status-detail').textContent = detail;
}

function hideMobiStatus() {
  $('#mobi-status').classList.add('is-hidden');
}

function setMobiProgress(progress) {
  const safeProgress = Math.max(0, Math.min(1, Number(progress) || 0));
  const percent = Math.round(safeProgress * 100);
  $('#mobi-progress-bar').style.width = `${safeProgress * 100}%`;
  $('#mobi-progress-percent').textContent = `${percent}%`;
  const valueDisplay = $('#mobi-progress-value');
  if (valueDisplay) valueDisplay.textContent = `${percent}%`;
}

function setupMobiProgressBar() {
  const wrap = $('#mobi-progress-wrap');
  const bar = $('#mobi-progress-bar');
  if (!wrap || !bar || !mobiView) return;

  let isDragging = false;

  function getProgressFromEvent(event) {
    const rect = wrap.getBoundingClientRect();
    const x = (event.type.startsWith('touch') ? event.touches[0].clientX : event.clientX) - rect.left;
    return Math.max(0, Math.min(1, x / rect.width));
  }

  function handleProgressChange(fraction) {
    if (!mobiView) return;
    mobiView.goToFraction(fraction);
  }

  function onStart(event) {
    if (event.button !== undefined && event.button !== 0) return;
    isDragging = true;
    wrap.classList.add('dragging');
    const fraction = getProgressFromEvent(event);
    setMobiProgress(fraction);
    handleProgressChange(fraction);
    event.preventDefault();
  }

  function onMove(event) {
    if (!isDragging) return;
    const fraction = getProgressFromEvent(event);
    setMobiProgress(fraction);
    handleProgressChange(fraction);
    event.preventDefault();
  }

  function onEnd() {
    if (!isDragging) return;
    isDragging = false;
    wrap.classList.remove('dragging');
  }

  wrap.addEventListener('mousedown', onStart);
  wrap.addEventListener('touchstart', onStart, { passive: false });
  document.addEventListener('mousemove', onMove);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('mouseup', onEnd);
  document.addEventListener('touchend', onEnd);
}

function setMobiPage(current, total) {
  // 保留函数避免其他地方的调用报错，但不再更新 UI
}

function buildMobiTOC(toc) {
  const tocList = $('#mobi-toc-list');
  tocList.replaceChildren();
  
  if (!toc || toc.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'pdf-outline-empty';
    empty.textContent = t('reader.mobiNoOutline');
    tocList.appendChild(empty);
    return;
  }
  
  const renderTocItem = (item, level = 0) => {
    const li = document.createElement('li');
    li.className = 'pdf-outline-item';
    
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = item.label || t('reader.untitledChapter');
    button.style.paddingLeft = `${12 + level * 14}px`;
    button.addEventListener('click', async (e) => {
      e.preventDefault();
      if (mobiView && item.href) {
        await mobiView.goTo(item.href);
        toggleMobiTOC(false);
      }
    });
    
    li.appendChild(button);
    tocList.appendChild(li);
    
    if (item.subitems) {
      item.subitems.forEach(subitem => renderTocItem(subitem, level + 1));
    }
  };
  
  toc.forEach(item => renderTocItem(item));
}

export function toggleMobiTOC(force) {
  const sidebar = $('#mobi-sidebar');
  const show = typeof force === 'boolean' ? force : !sidebar.classList.contains('show');
  sidebar.classList.toggle('show', show);
  sidebar.setAttribute('aria-hidden', String(!show));
  $('#mobi-toc').setAttribute('aria-expanded', String(show));
}

export function mobiNext() {
  if (mobiView) mobiView.goRight?.();
}

export function mobiPrev() {
  if (mobiView) mobiView.goLeft?.();
}

// 全局翻页冷却标志（跨所有 wheel 监听器共享）
let globalIsFlipping = false;
let globalFlipCooldownTimer = null;

// Wheel 事件监听器设置（独立函数，供 renderMOBI 调用）
function setupMobiWheelListener(view) {
  let wheelDeltaX = 0;
  let wheelResetTimer = null;
  const WHEEL_THRESHOLD = 80; // 提高阈值到 80
  const FLIP_COOLDOWN = 500; // 延长冷却时间到 500ms
  
  const contents = view.renderer?.getContents?.();
  if (!contents || contents.length === 0) {
    console.warn('[MOBI] 无法获取 renderer contents');
    return null;
  }
  
  const iframeDoc = contents[0]?.doc;
  if (!iframeDoc) {
    console.warn('[MOBI] 无法获取 iframe document');
    return null;
  }
  
  console.log('[MOBI] 成功获取 iframe document，绑定 wheel 事件');
  
  const wheelHandler = (event) => {
    // 如果正在全局翻页冷却中，忽略所有滑动
    if (globalIsFlipping) {
      console.log('[MOBI] 翻页冷却中，忽略滑动');
      return;
    }
    
    const deltaX = event.deltaX;
    const deltaY = event.deltaY;
    
    // 更严格的横向判断：横向分量必须 > 垂直分量的 2 倍
    if (Math.abs(deltaX) <= Math.abs(deltaY) * 2.0) {
      wheelDeltaX = 0;
      return;
    }
    
    // 清除重置定时器
    clearTimeout(wheelResetTimer);
    
    // 累积横向滚动距离
    wheelDeltaX += deltaX;
    
    console.log(`[MOBI] Wheel 累积: ${wheelDeltaX.toFixed(1)}, 阈值: ${WHEEL_THRESHOLD}`);
    
    // 判断是否达到阈值
    if (Math.abs(wheelDeltaX) >= WHEEL_THRESHOLD) {
      console.log(`[MOBI] Wheel ✓ 触发翻页！累积=${wheelDeltaX.toFixed(1)}`);
      
      // 设置全局翻页标志，进入冷却期
      globalIsFlipping = true;
      
      // 清除之前的冷却定时器
      clearTimeout(globalFlipCooldownTimer);
      
      // 正值（向左滑）：下一页，负值（向右滑）：上一页
      if (wheelDeltaX > 0) {
        console.log('[MOBI] 向左滑动 -> 下一页');
        view.goRight?.();
      } else {
        console.log('[MOBI] 向右滑动 -> 上一页');
        view.goLeft?.();
      }
      
      // 立即重置累积值
      wheelDeltaX = 0;
      
      // 冷却时间后才允许下次翻页
      globalFlipCooldownTimer = setTimeout(() => {
        globalIsFlipping = false;
        console.log('[MOBI] 翻页冷却结束');
      }, FLIP_COOLDOWN);
      
    } else {
      // 300ms 内没有新的 wheel 事件，重置累积值
      wheelResetTimer = setTimeout(() => {
        wheelDeltaX = 0;
      }, 300);
    }
  };
  
  iframeDoc.addEventListener('wheel', wheelHandler, { passive: true });
  
  // 返回清理函数
  return () => {
    iframeDoc.removeEventListener('wheel', wheelHandler);
    clearTimeout(wheelResetTimer);
  };
}

// 键盘翻页：iframe 内的 keydown 不冒泡到主文档，需在 iframe document 上单独接管。
function setupMobiKeyboardListener(view) {
  const contents = view.renderer?.getContents?.();
  if (!contents || contents.length === 0) {
    console.warn('[MOBI] 无法获取 renderer contents');
    return null;
  }
  const iframeDoc = contents[0]?.doc;
  if (!iframeDoc) {
    console.warn('[MOBI] 无法获取 iframe document');
    return null;
  }

  const keyHandler = (event) => {
    if (event.target?.closest?.('input, textarea, select')) return;
    const navKeys = { ArrowLeft: -1, ArrowUp: -1, PageUp: -1, ArrowRight: 1, ArrowDown: 1, PageDown: 1 };
    const direction = navKeys[event.key];
    if (!direction) return;
    event.preventDefault();
    if (direction < 0) view.goLeft?.();
    else view.goRight?.();
  };

  iframeDoc.addEventListener('keydown', keyHandler);
  return () => iframeDoc.removeEventListener('keydown', keyHandler);
}

function setupMobiInteractions(view) {
  console.log('[MOBI] setupMobiInteractions 被调用，view=', view);
  
  if (!view) {
    console.error('[MOBI] setupMobiInteractions: view 对象为空！');
    return;
  }
  
  const container = $('#mobi-container');
  console.log('[MOBI] container=', container);
  
  // 移除旧的事件监听器
  const oldClickHandler = container._mobiClickHandler;
  const oldGestureHandler = container._mobiGestureHandler;
  if (oldClickHandler) container.removeEventListener('click', oldClickHandler);
  if (oldGestureHandler) {
    container.removeEventListener('touchstart', oldGestureHandler.touchStart, true);
    container.removeEventListener('touchend', oldGestureHandler.touchEnd, true);
    container.removeEventListener('pointerdown', oldGestureHandler.pointerDown, true);
    container.removeEventListener('pointerup', oldGestureHandler.pointerUp, true);
    container.removeEventListener('wheel', oldGestureHandler.wheelHandler, true);
    // 也从 view 上移除
    if (view) {
      view.removeEventListener('touchstart', oldGestureHandler.touchStart, true);
      view.removeEventListener('touchend', oldGestureHandler.touchEnd, true);
      view.removeEventListener('pointerdown', oldGestureHandler.pointerDown, true);
      view.removeEventListener('pointerup', oldGestureHandler.pointerUp, true);
      view.removeEventListener('wheel', oldGestureHandler.wheelHandler, true);
    }
    // 从 iframe documents 移除
    if (oldGestureHandler.iframeWheelCleanup) {
      oldGestureHandler.iframeWheelCleanup();
    }
  }
  
  // 点击翻页
  const clickHandler = (e) => {
    // 忽略链接点击
    if (e.target.closest('a')) return;
    
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;
    
    // 左边 1/3 区域：上一页
    if (x < width / 3) {
      view.goLeft?.();
    }
    // 右边 1/3 区域：下一页
    else if (x > width * 2 / 3) {
      view.goRight?.();
    }
  };
  
  // Wheel 事件处理（在 iframe 的 document 上监听，关键！）
  const setupMobiWheelListener = (view) => {
    let wheelDeltaX = 0;
    let wheelResetTimer = null;
    const WHEEL_THRESHOLD = 80; // 触发翻页的累积滚动阈值
    
    const contents = view.renderer?.getContents?.();
    if (!contents || contents.length === 0) {
      console.warn('[MOBI] 无法获取 renderer contents');
      return null;
    }
    
    const iframeDoc = contents[0]?.doc;
    if (!iframeDoc) {
      console.warn('[MOBI] 无法获取 iframe document');
      return null;
    }
    
    console.log('[MOBI] 成功获取 iframe document，绑定 wheel 事件');
    
    const wheelHandler = (event) => {
      const deltaX = event.deltaX;
      const deltaY = event.deltaY;
      
      // 忽略主要为垂直滚动的情况
      if (Math.abs(deltaY) > Math.abs(deltaX)) {
        wheelDeltaX = 0;
        return;
      }
      
      // 清除重置定时器
      clearTimeout(wheelResetTimer);
      
      // 累积横向滚动距离
      wheelDeltaX += deltaX;
      
      console.log(`[MOBI] Wheel 累积: deltaX=${wheelDeltaX.toFixed(1)}, 本次=${deltaX.toFixed(1)}, deltaY=${deltaY.toFixed(1)}`);
      
      // 判断是否达到阈值
      if (Math.abs(wheelDeltaX) >= WHEEL_THRESHOLD) {
        console.log(`[MOBI] Wheel ✓ 触发翻页！累积=${wheelDeltaX.toFixed(1)}`);
        
        // 正值（向左滑）：下一页，负值（向右滑）：上一页
        if (wheelDeltaX > 0) {
          console.log('[MOBI] 向左滑动 -> 下一页');
          view.goRight?.();
        } else {
          console.log('[MOBI] 向右滑动 -> 上一页');
          view.goLeft?.();
        }
        
        // 重置累积值
        wheelDeltaX = 0;
      }
      
      // 300ms 内没有新的 wheel 事件，重置累积值
      wheelResetTimer = setTimeout(() => {
        console.log('[MOBI] Wheel 超时重置');
        wheelDeltaX = 0;
      }, 300);
    };
    
    iframeDoc.addEventListener('wheel', wheelHandler, { passive: true });
    
    // 返回清理函数
    return () => {
      iframeDoc.removeEventListener('wheel', wheelHandler);
      clearTimeout(wheelResetTimer);
    };
  };
  
  // 尝试设置 iframe wheel 监听器
  // 注意：不在这里调用，而是在 renderMOBI 中通过 load 事件动态绑定
  
  const gestureHandlers = { 
    clickHandler,
    iframeWheelCleanup: null  // 将在 renderMOBI 中管理
  };
  
  container._mobiClickHandler = clickHandler;
  container._mobiGestureHandler = gestureHandlers;
  
  container.addEventListener('click', clickHandler);
  
  console.log('[MOBI] 已启用点击翻页和 iframe wheel 手势支持');
  console.log('[MOBI] 请尝试触控板滑动，查看控制台是否有 Wheel 事件日志');
}

// 页码跳转已废弃
function setupMobiPageJump() {
  // 保留函数避免调用报错
}

export async function renderMOBI(url, filename, requestId, restoreLocation = null) {
  console.log('[renderMOBI] 开始渲染:', filename);
  console.log('[renderMOBI] URL:', url);
  console.log('[renderMOBI] requestId:', requestId);
  
  // 立即显示保存的进度（如果有）
  const savedProgress = getBookReadingProgress(filename);
  setMobiProgress(savedProgress);
  
  try {
    setMobiStatus(t('reader.loadingMobi'), t('reader.preparingLibrary'));
    
    // 先加载 foliate-js
    console.log('[MOBI] 步骤 1: 加载 foliate-js...');
    await loadFoliateJS();
    console.log('[MOBI] 步骤 1 完成: foliate-js 已加载');
    
    setMobiStatus(t('reader.loadingMobi'), t('reader.waitingLibraryInit'));
    
    // 等待 foliate-js 注册完成
    console.log('[MOBI] 步骤 2: 等待 foliate-view 注册...');
    await waitForLibrary();
    console.log('[MOBI] 步骤 2 完成: foliate-view 已注册');
    
    const container = $('#mobi-container');
    container.replaceChildren();
    
    setMobiStatus(t('reader.loadingMobi'), t('reader.creatingReader'));
    
    // 创建 foliate-view 元素
    console.log('[MOBI] 步骤 3: 创建 foliate-view 元素');
    mobiView = document.createElement('foliate-view');
    mobiView.requestId = requestId;
    container.appendChild(mobiView);
    console.log('[MOBI] 步骤 3 完成: foliate-view 元素已创建并添加到 DOM');
    
    setMobiStatus(t('reader.parsingMobi'), t('reader.loadingFileContent'));
    
    console.log('[MOBI] 步骤 4: 调用 open() 方法...');
    console.log('[MOBI] 文件 URL:', url);
    
    // 打开 MOBI 文件
    await mobiView.open(url);
    console.log('[MOBI] 步骤 4 完成: open() 返回成功');
    
    // 按照 reader.js 的顺序，在 open() 之后添加事件监听器
    console.log('[MOBI] 步骤 5: 添加事件监听器');
    
    // 存储 iframe 监听器清理函数，用于每次 load 后重新绑定（iframe 会重建）
    let currentWheelCleanup = null;
    let currentKeyboardCleanup = null;
    
    mobiView.addEventListener('load', (e) => {
      console.log('[MOBI] ✓ load 事件触发:', e.detail);
      
      // 每次 load 后重新绑定监听器（因为 iframe 被重新创建）
      if (currentWheelCleanup) {
        currentWheelCleanup();
      }
      currentWheelCleanup = setupMobiWheelListener(mobiView);
      if (currentKeyboardCleanup) {
        currentKeyboardCleanup();
      }
      currentKeyboardCleanup = setupMobiKeyboardListener(mobiView);
    });
    
    mobiView.addEventListener('relocate', (e) => {
      const detail = e.detail;
      console.log('[MOBI] relocate 事件:', detail);
      
      // 更新进度
      if (typeof detail.fraction === 'number') {
        setMobiProgress(detail.fraction);
        
        // 保存阅读进度
        const location = detail.cfi ? { kind: 'mobi-cfi', value: detail.cfi } : undefined;
        updateBookProgress(state.activeFile, detail.fraction, location);
      }
    });
    
    // 构建目录
    if (mobiView.book?.toc) {
      console.log('[MOBI] 构建目录...');
      buildMobiTOC(mobiView.book.toc);
    }
    
    // 关键步骤：导航到保存的位置或第一页
    console.log('[MOBI] 步骤 6: 调用 goTo() 开始渲染...');
    
    // 恢复到保存的位置或从头开始
    if (restoreLocation?.kind === 'mobi-cfi' && restoreLocation.value) {
      console.log('[MOBI] 恢复到保存的 CFI 位置:', restoreLocation.value);
      await mobiView.goTo(restoreLocation.value);
    } else if (typeof savedProgress === 'number' && savedProgress > 0) {
      console.log('[MOBI] 恢复到进度:', Math.round(savedProgress * 100) + '%');
      await mobiView.goToFraction(savedProgress);
    } else {
      console.log('[MOBI] 从第一页开始');
      await mobiView.goTo(0);
    }
    
    console.log('[MOBI] 步骤 6 完成: 已导航到目标位置');
    
    // 保存到全局状态，供键盘导航使用
    state.mobiView = mobiView;
    
    // 添加点击翻页支持
    setupMobiInteractions(mobiView);
    
    // 初始绑定 iframe 监听器
    currentWheelCleanup = setupMobiWheelListener(mobiView);
    currentKeyboardCleanup = setupMobiKeyboardListener(mobiView);
    
    // 设置进度条交互
    setupMobiProgressBar();
    setupMobiPageJump();
    
    const metadata = state.booksMetadata?.[filename];
    let title;
    
    if (metadata?.title) {
      // 使用 books.json 中的自定义标题
      title = metadata.title;
    } else {
      // 回退到从文件名推断
      const basename = filename.split('/').pop();
      const nameWithoutExt = basename.replace(/\.(mobi|azw3?)$/i, '');
      title = nameWithoutExt.split('-')[0].trim();
    }
    
    $('#mobi-title').textContent = title;

    // 设置下载链接
    const dlLink = $('#mobi-download');
    if (dlLink) {
      dlLink.href = url;
      dlLink.download = filename.split('/').pop();
    }
    
    console.log('[MOBI] 步骤 7: 隐藏加载状态');
    hideMobiStatus();
    markBookOpened(filename);
    
    console.log('[renderMOBI] ✓ 渲染完成');
    
  } catch (error) {
    console.error('[renderMOBI] ✗ 渲染失败');
    console.error('[renderMOBI] 错误类型:', error.constructor.name);
    console.error('[renderMOBI] 错误消息:', error.message);
    console.error('[renderMOBI] 错误堆栈:', error.stack);
    setMobiStatus(t('reader.mobiLoadFailedTitle'), error.message || t('reader.cannotOpenFile'), true);
  }
}

export function destroyMOBI() {
  if (mobiView) {
    try {
      // foliate-view 可能没有 destroy 方法，直接移除即可
      mobiView.remove();
      mobiView = null;
      state.mobiView = null;
    } catch (error) {
      console.warn('[destroyMOBI] 清理失败:', error);
    }
  }
}

export function resetMobiState() {
  destroyMOBI();
  const container = $('#mobi-container');
  if (container) container.replaceChildren();
  $('#mobi-title').textContent = '—';
  hideMobiStatus();
  setMobiProgress(0);
  state.mobiView = null;
  const dlLink = $('#mobi-download');
  if (dlLink) { dlLink.removeAttribute('href'); dlLink.removeAttribute('download'); }
}
