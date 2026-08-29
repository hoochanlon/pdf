// 侧边栏控制模块
import { $, isMobile } from './utils.js';

const sidebar = $('#sidebar');
const overlay = $('#overlay');
const toggleButton = $('#toggle-btn');
function setSidebarToggleState(status) {
  const expanded = status === 'expanded';
  toggleButton.dataset.sidebarState = status;
  toggleButton.setAttribute('aria-controls', 'sidebar');
  toggleButton.setAttribute('aria-expanded', String(expanded));
  toggleButton.setAttribute('aria-label', expanded ? '收起书架' : '展开书架');
  toggleButton.title = expanded ? '收起书架' : '展开书架';
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
  setSidebarToggleState(collapsed ? 'collapsed' : 'expanded');
  localStorage.setItem('sidebarCollapsed', String(collapsed));
}

export function syncSidebar() {
  const mobile = isMobile();
  if (mobile) {
    document.documentElement.style.removeProperty('--sidebar-width');
    sidebar.classList.remove('collapsed');
    closeSidebar();
    setSidebarToggleState('collapsed');
  } else {
    closeSidebar();
    const collapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    sidebar.classList.toggle('collapsed', collapsed);
    setSidebarToggleState(collapsed ? 'collapsed' : 'expanded');
  }
}

export function initSidebar() {
  toggleButton.addEventListener('click', toggleSidebar);
  overlay.addEventListener('click', closeSidebar);

  window.matchMedia('(max-width: 768px)').addEventListener('change', syncSidebar);
  syncSidebar();
}
