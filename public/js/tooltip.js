// 现代化 Tooltip 系统
// 自动将 title 属性转换为自定义 tooltip

export function initTooltips() {
  // 转换页面中所有带 title 属性的元素
  convertTitleToTooltip(document.body);
  
  // 监听动态添加的元素
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          convertTitleToTooltip(node);
        }
      });
      
      // 监听 title 属性变化
      if (mutation.type === 'attributes' && mutation.attributeName === 'title') {
        const element = mutation.target;
        const title = element.getAttribute('title');
        if (title && title.trim()) {
          element.setAttribute('data-tooltip', title);
          element.removeAttribute('title');
        }
      }
    });
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['title']
  });
}

function convertTitleToTooltip(root) {
  // 转换根元素本身
  if (root.hasAttribute?.('title')) {
    const title = root.getAttribute('title');
    if (title && title.trim()) {
      // 如果已有 data-tooltip，不覆盖
      if (!root.hasAttribute('data-tooltip')) {
        root.setAttribute('data-tooltip', title);
      }
      root.removeAttribute('title');
    }
  }
  
  // 转换所有子元素
  const elements = root.querySelectorAll?.('[title]') || [];
  elements.forEach((element) => {
    const title = element.getAttribute('title');
    if (title && title.trim()) {
      // 如果已有 data-tooltip，不覆盖
      if (!element.hasAttribute('data-tooltip')) {
        element.setAttribute('data-tooltip', title);
      }
      element.removeAttribute('title');
      
      // 根据元素位置智能选择tooltip方向
      autoPositionTooltip(element);
    }
  });
}

function autoPositionTooltip(element) {
  // 可以根据元素在视口中的位置自动设置tooltip方向
  // 这里提供一个简单的实现，可以根据需要扩展
  
  element.addEventListener('mouseenter', () => {
    const rect = element.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    
    // 如果元素在视口顶部，tooltip显示在底部
    if (rect.top < 100) {
      element.setAttribute('data-tooltip-pos', 'bottom');
    }
    // 如果元素在视口底部，tooltip显示在顶部
    else if (rect.bottom > viewportHeight - 100) {
      element.setAttribute('data-tooltip-pos', 'top');
    }
    // 如果元素在左侧，tooltip显示在右侧
    else if (rect.left < 100) {
      element.setAttribute('data-tooltip-pos', 'right');
    }
    // 如果元素在右侧，tooltip显示在左侧
    else if (rect.right > viewportWidth - 100) {
      element.setAttribute('data-tooltip-pos', 'left');
    }
    // 否则默认在顶部
    else {
      element.removeAttribute('data-tooltip-pos');
    }
  }, { once: false });
}

// 提供手动更新 tooltip 的方法
export function updateTooltip(element, text) {
  if (element && text) {
    element.setAttribute('data-tooltip', text);
    // 确保没有 title 属性
    element.removeAttribute('title');
  }
}
