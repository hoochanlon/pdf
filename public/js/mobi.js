// MOBI 渲染模块 - 使用 foliate-js
import { state } from './state.js';
import { $ } from './utils.js';
import { updateBookProgress, markBookOpened } from './reading.js';

let mobiView = null;
let foliateLoaded = false;

async function loadFoliateJS() {
  if (foliateLoaded) return;
  
  try {
    console.log('[MOBI] 开始加载 foliate-js...');
    // 从本地路径加载 foliate-js
    await import('/lib/foliate-js/view.js');
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
    if (!mobiView || mobiView.requestId !== requestId) {
      console.log('[MOBI] 步骤 3: 创建 foliate-view 元素');
      mobiView = document.createElement('foliate-view');
      mobiView.requestId = requestId;
      container.appendChild(mobiView);
      console.log('[MOBI] 步骤 3 完成: foliate-view 元素已创建并添加到 DOM');
      
      // 监听位置变化
      mobiView.addEventListener('relocate', (e) => {
        console.log('[MOBI] 位置变化:', e.detail);
        // TODO: 保存阅读进度
      });
      
      // 监听加载完成
      mobiView.addEventListener('load', () => {
        console.log('[MOBI] ✓ 文件加载完成事件触发');
      });
      
      // 监听渲染器就绪
      mobiView.addEventListener('renderer', () => {
        console.log('[MOBI] ✓ 渲染器就绪事件触发');
      });
    }
    
    setMobiStatus('正在解析 MOBI', '加载文件内容...');
    
    console.log('[MOBI] 步骤 4: 调用 open() 方法...');
    console.log('[MOBI] 文件 URL:', url);
    
    // 打开 MOBI 文件
    await mobiView.open(url);
    console.log('[MOBI] 步骤 4 完成: open() 返回成功');
    
    // 关键步骤：触发渲染器开始渲染第一页
    console.log('[MOBI] 步骤 5: 调用 renderer.next() 开始渲染...');
    if (mobiView.renderer && typeof mobiView.renderer.next === 'function') {
      await mobiView.renderer.next();
      console.log('[MOBI] 步骤 5 完成: 渲染器已启动');
    } else {
      console.warn('[MOBI] 警告: renderer.next() 不可用');
    }
    
    $('#mobi-title').textContent = filename.replace(/\.(mobi|azw3?)$/i, '');
    
    console.log('[MOBI] 步骤 6: 隐藏加载状态');
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
}
