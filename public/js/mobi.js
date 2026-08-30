// MOBI 渲染模块 - 使用 foliate-js
import { state } from './state.js';
import { $ } from './utils.js';
import { updateBookProgress, markBookOpened } from './reading.js';

let mobiView = null;
let foliateLoaded = false;

// 虚拟分页状态
let mobiCurrentPage = 0;
let mobiTotalPages = 0;
const CHARS_PER_PAGE = 1800; // 每页约 1800 字符

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
    throw new Error('无法加载 MOBI 阅读库: ' + error.message);
  }
}

async function waitForLibrary(timeout = 10000) {
  const startedAt = Date.now();
  while (typeof customElements.get('foliate-view') === 'undefined') {
    if (Date.now() - startedAt >= timeout) {
      throw new Error('foliate-js 初始化超时');
    }
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  console.log('[MOBI] foliate-view 元素已注册');
}

function setMobiStatus(title, detail = '') {
  const panel = $('#mobi-status');
  const isError = title.includes('失败') || title.includes('错误');
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
  $('#mobi-progress-bar').style.width = `${safeProgress * 100}%`;
  $('#mobi-progress-value').textContent = `${Math.round(safeProgress * 100)}%`;
}

function setMobiPage(current, total) {
  const input = $('#mobi-page-input');
  const output = $('#mobi-page-total');
  const ready = total > 0;
  const safeCurrent = ready ? Math.max(1, current) : current;
  input.disabled = !ready;
  input.max = ready ? String(total) : '';
  input.value = safeCurrent > 0 ? String(safeCurrent) : '';
  output.textContent = ready ? String(total) : '—';
  
  mobiCurrentPage = safeCurrent;
  mobiTotalPages = total;
}

function buildMobiTOC(toc) {
  const tocList = $('#mobi-toc-list');
  tocList.replaceChildren();
  
  if (!toc || toc.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'pdf-outline-empty';
    empty.textContent = '此书无目录';
    tocList.appendChild(empty);
    return;
  }
  
  const renderTocItem = (item, level = 0) => {
    const li = document.createElement('li');
    li.className = 'pdf-outline-item';
    
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = item.label || '未命名章节';
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

// 页码输入跳转
function setupMobiPageJump() {
  const input = $('#mobi-page-input');
  
  // 移除旧的监听器
  const oldHandler = input._mobiPageJumpHandler;
  if (oldHandler) {
    input.removeEventListener('change', oldHandler);
    input.removeEventListener('keydown', oldHandler);
  }
  
  const handleJump = async (e) => {
    if (e.type === 'keydown' && e.key !== 'Enter') return;
    
    const targetPage = parseInt(input.value, 10);
    if (!targetPage || targetPage < 1 || targetPage > mobiTotalPages) {
      input.value = mobiCurrentPage > 0 ? String(mobiCurrentPage) : '';
      return;
    }
    
    // 计算目标进度（页面从1开始，进度从0开始）
    const targetFraction = Math.max(0, Math.min(1, (targetPage - 1) / mobiTotalPages));
    
    // 使用 goToFraction 导航
    if (mobiView?.goToFraction) {
      try {
        await mobiView.goToFraction(targetFraction);
        console.log(`[MOBI] 跳转到虚拟页 ${targetPage} (${Math.round(targetFraction * 100)}%)`);
      } catch (error) {
        console.error('[MOBI] 页面跳转失败:', error);
        input.value = mobiCurrentPage > 0 ? String(mobiCurrentPage) : '';
      }
    }
  };
  
  input._mobiPageJumpHandler = handleJump;
  input.addEventListener('change', handleJump);
  input.addEventListener('keydown', handleJump);
}

export async function renderMOBI(url, filename, requestId) {
  console.log('[renderMOBI] 开始渲染:', filename);
  console.log('[renderMOBI] URL:', url);
  console.log('[renderMOBI] requestId:', requestId);
  
  try {
    setMobiStatus('正在加载 MOBI', '准备阅读库...');
    
    // 先加载 foliate-js
    console.log('[MOBI] 步骤 1: 加载 foliate-js...');
    await loadFoliateJS();
    console.log('[MOBI] 步骤 1 完成: foliate-js 已加载');
    
    setMobiStatus('正在加载 MOBI', '等待阅读库初始化...');
    
    // 等待 foliate-js 注册完成
    console.log('[MOBI] 步骤 2: 等待 foliate-view 注册...');
    await waitForLibrary();
    console.log('[MOBI] 步骤 2 完成: foliate-view 已注册');
    
    const container = $('#mobi-container');
    container.replaceChildren();
    
    setMobiStatus('正在加载 MOBI', '创建阅读器...');
    
    // 创建 foliate-view 元素
    console.log('[MOBI] 步骤 3: 创建 foliate-view 元素');
    mobiView = document.createElement('foliate-view');
    mobiView.requestId = requestId;
    container.appendChild(mobiView);
    console.log('[MOBI] 步骤 3 完成: foliate-view 元素已创建并添加到 DOM');
    
    setMobiStatus('正在解析 MOBI', '加载文件内容...');
    
    console.log('[MOBI] 步骤 4: 调用 open() 方法...');
    console.log('[MOBI] 文件 URL:', url);
    
    // 打开 MOBI 文件
    await mobiView.open(url);
    console.log('[MOBI] 步骤 4 完成: open() 返回成功');
    
    // 按照 reader.js 的顺序，在 open() 之后添加事件监听器
    console.log('[MOBI] 步骤 5: 添加事件监听器');
    
    // 存储 wheel 清理函数，用于每次 load 后重新绑定
    let currentWheelCleanup = null;
    
    mobiView.addEventListener('load', (e) => {
      console.log('[MOBI] ✓ load 事件触发:', e.detail);
      
      // 每次 load 后重新绑定 wheel 监听器（因为 iframe 被重新创建）
      if (currentWheelCleanup) {
        currentWheelCleanup();
      }
      currentWheelCleanup = setupMobiWheelListener(mobiView);
    });
    
    mobiView.addEventListener('relocate', (e) => {
      const detail = e.detail;
      console.log('[MOBI] relocate 事件:', detail);
      
      // 更新进度
      if (typeof detail.fraction === 'number') {
        setMobiProgress(detail.fraction);
        
        // 计算虚拟页码
        if (mobiTotalPages > 0) {
          const currentPage = Math.max(1, Math.ceil(detail.fraction * mobiTotalPages));
          setMobiPage(currentPage, mobiTotalPages);
        }
        
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
    
    // 计算虚拟页数（基于书籍章节大小估算）
    if (mobiView.book?.sections) {
      try {
        // 累加所有章节的字节大小
        const totalSize = mobiView.book.sections.reduce((sum, section) => {
          return sum + (section.size || 0);
        }, 0);
        
        if (totalSize > 0) {
          // 基于总字节数估算页数（每页约 1800 字符 = 约 5400 字节，假设 UTF-8 编码）
          const BYTES_PER_PAGE = CHARS_PER_PAGE * 3;
          mobiTotalPages = Math.max(1, Math.ceil(totalSize / BYTES_PER_PAGE));
          console.log(`[MOBI] 估算虚拟页数: ${mobiTotalPages} (基于 ${totalSize} 字节, ${mobiView.book.sections.length} 章节)`);
        } else {
          // 默认值：基于章节数估算（每章约 10 页）
          mobiTotalPages = Math.max(1, mobiView.book.sections.length * 10);
          console.log(`[MOBI] 使用默认虚拟页数: ${mobiTotalPages} (${mobiView.book.sections.length} 章节)`);
        }
        setMobiPage(1, mobiTotalPages);
      } catch (error) {
        console.warn('[MOBI] 无法计算虚拟页数:', error);
        mobiTotalPages = 100;
        setMobiPage(1, mobiTotalPages);
      }
    }
    
    // 关键步骤：导航到第一页来触发渲染
    console.log('[MOBI] 步骤 6: 调用 goTo() 开始渲染第一页...');
    if (mobiView.renderer && typeof mobiView.renderer.goTo === 'function') {
      // 固定分页模式
      mobiView.renderer.setAttribute('flow', 'paginated');
      
      // 使用 goTo 导航到第一个章节，这会触发 #display() 创建视图
      await mobiView.renderer.goTo({ index: 0 });
      console.log('[MOBI] 步骤 6 完成: 已导航到第一页');
    } else {
      console.error('[MOBI] 错误: renderer 不可用或没有 goTo() 方法');
      console.log('[MOBI] mobiView.renderer:', mobiView.renderer);
    }
    
    // 保存到全局状态，供键盘导航使用
    state.mobiView = mobiView;
    
    // 添加点击翻页支持
    setupMobiInteractions(mobiView);
    
    // 初始绑定 wheel 监听器
    currentWheelCleanup = setupMobiWheelListener(mobiView);
    
    // 设置页码跳转
    setupMobiPageJump();
    
    $('#mobi-title').textContent = filename.replace(/\.(mobi|azw3?)$/i, '');
    
    console.log('[MOBI] 步骤 7: 隐藏加载状态');
    hideMobiStatus();
    markBookOpened(filename);
    
    console.log('[renderMOBI] ✓ 渲染完成');
    
  } catch (error) {
    console.error('[renderMOBI] ✗ 渲染失败');
    console.error('[renderMOBI] 错误类型:', error.constructor.name);
    console.error('[renderMOBI] 错误消息:', error.message);
    console.error('[renderMOBI] 错误堆栈:', error.stack);
    setMobiStatus('MOBI 加载失败', error.message || '无法打开此文件');
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
  setMobiPage(0, 0);
  mobiCurrentPage = 0;
  mobiTotalPages = 0;
  state.mobiView = null;
}
