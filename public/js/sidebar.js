// 侧边栏控制模块
import { state } from './state.js';
import { $, isMobile } from './utils.js';

const sidebar = $('#sidebar');
const overlay = $('#overlay');
const toggleButton = $('#toggle-btn');
const sidebarResizer = $('#sidebar-resizer');

function setSidebarToggleState(status) {
  const expanded = status === 'expanded';
  toggleButton.dataset.sidebarState = status;
  toggleButton.setAttribute('aria-controls', 'sidebar');
  toggleButton.setAttribute('aria-expanded', String(expanded));
  toggleButton.setAttribute('aria-label', expanded ? '收起书架' : '展开书架');
  toggleButton.title = expanded ? '收起书架' : '展开书架';
}

export function resizeSidebar(width) {
  const min = 220;
  const max = Math.min(440, window.innerWidth * 0.45);
  const nextWidth = Math.max(min, Math.min(max, width));
  document.documentElement.style.setProperty('--sidebar-width', `${nextWidth}px`);
  localStorage.setItem('sidebarWidth', String(nextWidth));
}

let sidebarResizeStart = null;
function stopSidebarResize() {
  if (!sidebarResizeStart) return;
  sidebarResizeStart = null;
  document.body.classList.remove('resizing-sidebar');
  window.removeEventListener('pointermove', moveSidebarResize);
  window.removeEventListener('pointerup', stopSidebarResize);
}
function moveSidebarResize(event) {
  if (sidebarResizeStart) resizeSidebar(sidebarResizeStart.width + event.clientX - sidebarResizeStart.x);
}
function startSidebarResize(event) {
  if (isMobile() || sidebar.classList.contains('collapsed')) return;
  sidebarResizeStart = { x: event.clientX, width: sidebar.getBoundingClientRect().width };
  document.body.classList.add('resizing-sidebar');
  sidebarResizer.setPointerCapture?.(event.pointerId);
  window.addEventListener('pointermove', moveSidebarResize);
  window.addEventListener('pointerup', stopSidebarResize);
}

export function closeSidebar() {
  sidebar.classList.remove('mobile-open');
  overlay.classList.remove('show');
  document.body.classList.remove('sidebar-open');
  if (isMobile()) setSidebarToggleState('collapsed');
}

export function toggleSidebar() {
  if (isMobile()) {
    const open = sidebar.classList.toggle('mobile-open');
    overlay.classList.toggle('show', open);
    document.body.classList.toggle('sidebar-open', open);
    setSidebarToggleState(open ? 'expanded' : 'collapsed');
    return;
  }
  const collapsed = sidebar.classList.toggle('collapsed');
  sidebarResizer.classList.toggle('hidden', collapsed);
  setSidebarToggleState(collapsed ? 'collapsed' : 'expanded');
  localStorage.setItem('sidebarCollapsed', String(collapsed));
}

export function syncSidebar() {
  const mobile = isMobile();
  if (mobile) {
    document.documentElement.style.removeProperty('--sidebar-width');
    sidebar.classList.remove('collapsed');
    sidebarResizer.classList.add('hidden');
    closeSidebar();
    setSidebarToggleState('collapsed');
  } else {
    closeSidebar();
    const savedWidth = Number(localStorage.getItem('sidebarWidth'));
    if (savedWidth) resizeSidebar(savedWidth);
    const collapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    sidebar.classList.toggle('collapsed', collapsed);
    sidebarResizer.classList.toggle('hidden', collapsed);
    setSidebarToggleState(collapsed ? 'collapsed' : 'expanded');
  }
}

export function initSidebar() {
  sidebarResizer.addEventListener('pointerdown', startSidebarResize);
  sidebarResizer.addEventListener('keydown', (event) => {
    if (isMobile() || sidebar.classList.contains('collapsed')) return;
    const width = sidebar.getBoundingClientRect().width;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      resizeSidebar(width - 16);
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      resizeSidebar(width + 16);
    }
  });

  toggleButton.addEventListener('click', toggleSidebar);
  overlay.addEventListener('click', closeSidebar);

  window.matchMedia('(max-width: 768px)').addEventListener('change', syncSidebar);
  syncSidebar();
}
