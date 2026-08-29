// PDF.js 配置
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let pdfDoc = null;
let pageNum = 1;
let pageRendering = false;
let pageNumPending = null;
let scale = 1;

const canvas = document.getElementById('pdf-canvas');
const ctx = canvas.getContext('2d');
const loading = document.getElementById('loading');
const emptyState = document.querySelector('.empty-state');

// 加载 PDF 列表
async function loadPDFList() {
  try {
    const response = await fetch('/api/pdfs');
    const files = await response.json();
    
    const listEl = document.getElementById('pdf-list');
    listEl.innerHTML = '';
    
    if (files.length === 0) {
      listEl.innerHTML = '<li style="color: #999;">暂无 PDF 文件</li>';
      return;
    }
    
    files.forEach(file => {
      const li = document.createElement('li');
      li.className = 'pdf-item';
      li.textContent = file;
      li.onclick = () => loadPDF(file);
      listEl.appendChild(li);
    });
  } catch (error) {
    console.error('加载 PDF 列表失败:', error);
  }
}

// 加载 PDF 文件
async function loadPDF(filename) {
  loading.classList.add('show');
  
  try {
    const url = `/uploads/${encodeURIComponent(filename)}`;
    const loadingTask = pdfjsLib.getDocument(url);
    pdfDoc = await loadingTask.promise;
    
    document.getElementById('page-count').textContent = pdfDoc.numPages;
    document.getElementById('page-num').disabled = false;
    document.getElementById('page-num').max = pdfDoc.numPages;
    document.getElementById('prev-page').disabled = false;
    document.getElementById('next-page').disabled = false;
    
    // 高亮当前选中的文件
    document.querySelectorAll('.pdf-item').forEach(item => {
      item.classList.toggle('active', item.textContent === filename);
    });
    
    // 显示 canvas，隐藏空状态
    emptyState.style.display = 'none';
    canvas.style.display = 'block';
    
    pageNum = 1;
    document.getElementById('page-num').value = 1;
    renderPage(pageNum);
  } catch (error) {
    console.error('加载 PDF 失败:', error);
    alert('加载 PDF 失败: ' + error.message);
  } finally {
    loading.classList.remove('show');
  }
}

// 渲染页面
function renderPage(num) {
  if (!pdfDoc) return;
  
  pageRendering = true;
  
  pdfDoc.getPage(num).then(page => {
    const viewport = page.getViewport({ scale });
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    
    const renderContext = {
      canvasContext: ctx,
      viewport: viewport
    };
    
    const renderTask = page.render(renderContext);
    
    renderTask.promise.then(() => {
      pageRendering = false;
      if (pageNumPending !== null) {
        renderPage(pageNumPending);
        pageNumPending = null;
      }
    });
  });
  
  document.getElementById('page-num').value = num;
}

// 排队渲染页面
function queueRenderPage(num) {
  if (pageRendering) {
    pageNumPending = num;
  } else {
    renderPage(num);
  }
}

// 上一页
document.getElementById('prev-page').addEventListener('click', () => {
  if (pageNum <= 1) return;
  pageNum--;
  queueRenderPage(pageNum);
});

// 下一页
document.getElementById('next-page').addEventListener('click', () => {
  if (pageNum >= pdfDoc.numPages) return;
  pageNum++;
  queueRenderPage(pageNum);
});

// 跳转到指定页
document.getElementById('page-num').addEventListener('change', (e) => {
  let num = parseInt(e.target.value);
  if (num < 1) num = 1;
  if (num > pdfDoc.numPages) num = pdfDoc.numPages;
  pageNum = num;
  queueRenderPage(pageNum);
});

// 缩放
document.getElementById('zoom').addEventListener('change', (e) => {
  scale = parseFloat(e.target.value);
  queueRenderPage(pageNum);
});

// 键盘导航
document.addEventListener('keydown', (e) => {
  if (!pdfDoc) return;
  
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (pageNum > 1) {
      pageNum--;
      queueRenderPage(pageNum);
    }
  } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault();
    if (pageNum < pdfDoc.numPages) {
      pageNum++;
      queueRenderPage(pageNum);
    }
  }
});

// 初始化
loadPDFList();
