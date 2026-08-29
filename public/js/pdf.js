// PDF 渲染模块
import { state } from './state.js';
import { $, isMobile } from './utils.js';

const PDF_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;

export async function renderMobilePDF(url, requestId) {
  if (!window.pdfjsLib) return showReaderError('PDF.js 加载失败，请刷新重试', 'pdf-mobile');
  const container = $('#pdf-canvas-container');
  container.innerHTML = '<div class="reader-loading">正在准备 PDF…</div>';
  state.pdfUrl = url;
  try {
    const loading = window.pdfjsLib.getDocument({ url, disableAutoFetch: false, disableStream: false });
    state.pdfLoading = loading;
    const pdf = await loading.promise;
    if (requestId !== state.requestId) return;
    state.pdf = pdf;
    container.replaceChildren();
    const shells = [];
    const firstPage = await pdf.getPage(1);
    if (requestId !== state.requestId) return;
    const firstViewport = firstPage.getViewport({ scale: 1 });
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const shell = document.createElement('div');
      shell.className = 'pdf-page-shell';
      shell.dataset.page = pageNumber;
      shell.dataset.aspectRatio = `${firstViewport.width} / ${firstViewport.height}`;
      shell.style.aspectRatio = shell.dataset.aspectRatio;
      shell.innerHTML = `<span class="page-number">${pageNumber}</span>`;
      if (pageNumber === 1) shell._page = firstPage;
      shells.push(shell);
      container.appendChild(shell);
    }
    state.pdfViewportWidth = container.clientWidth;
    state.pdfObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        entry.target.dataset.visible = String(entry.isIntersecting);
        if (entry.isIntersecting) {
          renderPDFPage(entry.target, requestId);
        } else {
          releasePDFPage(entry.target);
        }
      });
    }, { root: container, rootMargin: '720px 0px', threshold: 0 });
    shells.forEach((shell) => state.pdfObserver.observe(shell));
  } catch (error) {
    if (requestId === state.requestId) {
      console.error('PDF 渲染失败:', error);
      showReaderError('PDF 加载失败，请检查文件是否有效', 'pdf-mobile');
    }
  }
}

async function renderPDFPage(shell, requestId) {
  if (
    shell.dataset.rendered ||
    shell.dataset.rendering ||
    shell.dataset.visible !== 'true' ||
    requestId !== state.requestId ||
    !state.pdf
  ) return;
  shell.dataset.rendering = 'true';
  let task = null;
  try {
    const pageNumber = Number(shell.dataset.page);
    const page = shell._page || await state.pdf.getPage(pageNumber);
    if (
      requestId !== state.requestId ||
      shell.dataset.visible !== 'true' ||
      !state.pdf
    ) return;
    const width = Math.max(240, shell.clientWidth);
    const baseViewport = page.getViewport({ scale: 1 });
    shell.dataset.aspectRatio = `${baseViewport.width} / ${baseViewport.height}`;
    shell.style.aspectRatio = shell.dataset.aspectRatio;
    const cssScale = width / baseViewport.width;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: cssScale * pixelRatio });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    canvas.style.width = `${Math.ceil(viewport.width / pixelRatio)}px`;
    canvas.style.height = `${Math.ceil(viewport.height / pixelRatio)}px`;
    shell.replaceChildren(canvas);
    task = page.render({
      canvasContext: canvas.getContext('2d', { alpha: false }),
      viewport
    });
    state.pdfRenderTasks.set(shell, task);
    await task.promise;
    if (
      requestId === state.requestId &&
      shell.dataset.visible === 'true' &&
      shell.contains(canvas)
    ) {
      shell.dataset.rendered = 'true';
      delete shell._page;
    }
  } catch (error) {
    if (error?.name !== 'RenderingCancelledException') {
      console.warn(`第 ${shell.dataset.page} 页渲染失败`, error);
    }
  } finally {
    if (state.pdfRenderTasks.get(shell) === task) state.pdfRenderTasks.delete(shell);
    delete shell.dataset.rendering;
  }
}

function releasePDFPage(shell) {
  const task = state.pdfRenderTasks.get(shell);
  if (task) task.cancel();
  if (!shell.dataset.rendered && !shell.dataset.rendering) return;
  delete shell.dataset.rendering;
  shell.replaceChildren();
  shell.innerHTML = `<span class="page-number">${shell.dataset.page}</span>`;
  shell.style.aspectRatio = shell.dataset.aspectRatio || '';
  delete shell.dataset.rendered;
  delete shell.dataset.visible;
}

function showReaderError(message, reader = state.renderMode) {
  $('#empty-state').style.display = 'none';
  $('#pdf-frame').classList.remove('show');
  $('#pdf-canvas-container').classList.remove('show');
  $('#epub-reader').classList.remove('show');
  if (reader === 'pdf-mobile') {
    $('#pdf-canvas-container').classList.add('show');
    $('#pdf-canvas-container').innerHTML = `<div class="reader-error">${message}</div>`;
  } else {
    $('#epub-reader').classList.add('show');
    $('#epub-container').innerHTML = `<div class="reader-error">${message}</div>`;
  }
}
