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
    await import('https://cdn.jsdelivr.net/gh/johnfactotum/foliate-js@main/view.js');
    foliateLoaded = true;
    console.log('[MOBI] foliate-js 加载成功');
  } catch (error) {
    console.error('[MOBI] foliate-js 加载失败:', error);
    throw new Error('无法加载 MOBI 阅读库');
  }
}

async function waitForLibrary(timeout = 8000) {
  const startedAt = Date.now();
  while (typeof customElements.get('foliate-view') === 'undefined') {
    if (Date.now() - startedAt >= timeout) {
      throw new Error('foliate-js 加载超时');
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
  
  try {
    setMobiStatus('MOBI 格式支持开发中', 'foliate-js 集成正在完善，当前版本暂时无法渲染 MOBI 文件。建议使用 Calibre 等工具将 MOBI 转换为 EPUB 格式阅读。');
    
    // TODO: 完善 foliate-js 集成
    // 问题：foliate-js 作为 ES 模块从 CDN 加载存在依赖和跨域问题
    // 解决方案：
    // 1. 下载 foliate-js 完整源码到项目中
    // 2. 或使用打包后的版本
    // 3. 或在服务端转换 MOBI 为 EPUB
    
    /* 
    setMobiStatus('正在加载 MOBI', '准备阅读库...');
    
    // 先加载 foliate-js
    await loadFoliateJS();
    
    setMobiStatus('正在加载 MOBI', '等待阅读库初始化...');
    
    // 等待 foliate-js 注册完成
    await waitForLibrary();
    
    const container = $('#mobi-container');
    container.replaceChildren();
    
    setMobiStatus('正在加载 MOBI', '创建阅读器...');
    
    // 创建 foliate-view 元素
    if (!mobiView || mobiView.requestId !== requestId) {
      console.log('[MOBI] 创建 foliate-view 元素');
      mobiView = document.createElement('foliate-view');
      mobiView.requestId = requestId;
      container.appendChild(mobiView);
      
      // 监听位置变化
      mobiView.addEventListener('relocate', (e) => {
        console.log('[MOBI] 位置变化:', e.detail);
        // TODO: 保存阅读进度
      });
    }
    
    setMobiStatus('正在解析 MOBI', '加载文件内容...');
    
    console.log('[MOBI] 打开文件:', url);
    
    // 打开 MOBI 文件
    await mobiView.open(url);
    
    $('#mobi-title').textContent = filename.replace(/\.(mobi|azw3?)$/i, '');
    
    hideMobiStatus();
    markBookOpened(filename);
    
    console.log('[renderMOBI] 渲染完成');
    */
    
  } catch (error) {
    console.error('[renderMOBI] 渲染失败:', error);
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
