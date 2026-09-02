/**
 * 自定义下拉选择组件
 */
export class CustomSelect {
  constructor(trigger, listbox, opts = {}) {
    this._trigger = trigger;
    this._listbox = listbox;
    this._onChange = opts.onChange || null;
    this._theme = opts.theme || null;   // 'toolbar' | 'filter' | null
    this._options = [];
    this._value = '';
    this._open = false;
    this._focusedIndex = -1;
    this._closeRaf = 0;

    // 将 theme 写到 listbox，方便 CSS 选择（挂到 body 后父级选择器失效）
    if (this._theme) this._listbox.dataset.csTheme = this._theme;

    this._bind();
  }

  // ── 公开 API ──────────────────────────────────────────────

  setOptions(options) {
    this._options = options;
    this._renderList();
    const still = options.some(o => o.value === this._value);
    this.setValue(still ? this._value : (options[0]?.value ?? ''), true);
  }

  getValue() { return this._value; }

  setValue(value, silent = false) {
    const opt = this._options.find(o => o.value === value);
    if (!opt && this._options.length) return;
    this._value = value;
    this._trigger.querySelector('.cs-label').textContent = opt?.label ?? value;
    this._listbox.querySelectorAll('.cs-option').forEach(el => {
      const selected = el.dataset.value === value;
      el.classList.toggle('is-selected', selected);
      el.setAttribute('aria-selected', String(selected));
    });
    if (!silent && this._onChange) this._onChange(value);
  }

  destroy() {
    document.removeEventListener('mousedown', this._onOutside, true);
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('scroll', this._onResize, true);
    if (this._listbox.parentElement === document.body) {
      document.body.removeChild(this._listbox);
    }
  }

  // ── 内部 ─────────────────────────────────────────────────

  _renderList() {
    this._listbox.replaceChildren();
    this._options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cs-option';
      btn.dataset.value = opt.value;
      btn.dataset.index = String(i);
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', String(opt.value === this._value));
      btn.textContent = opt.label;
      if (opt.value === this._value) btn.classList.add('is-selected');
      btn.addEventListener('mousedown', (e) => e.preventDefault()); // 防止失焦
      btn.addEventListener('click', () => {
        this.setValue(opt.value);
        this._close(false); // 选中后不需要重新聚焦 trigger
      });
      this._listbox.appendChild(btn);
    });
  }

  _open_() {
    if (this._open) return;
    cancelAnimationFrame(this._closeRaf);
    this._open = true;
    // 挂到 body，彻底脱离任何 overflow/stacking context 限制
    if (this._listbox.parentElement !== document.body) {
      document.body.appendChild(this._listbox);
    }
    this._positionListbox();
    this._listbox.hidden = false;
    requestAnimationFrame(() => {
      this._listbox.classList.add('is-open');
    });
    this._trigger.setAttribute('aria-expanded', 'true');
    const selectedIndex = this._options.findIndex(o => o.value === this._value);
    this._setFocus(selectedIndex >= 0 ? selectedIndex : 0);
  }

  _close(returnFocus = true) {
    if (!this._open) return;
    this._open = false;
    this._listbox.classList.remove('is-open');
    this._trigger.setAttribute('aria-expanded', 'false');
    this._focusedIndex = -1;
    if (returnFocus) this._trigger.focus();
    // 等过渡结束后隐藏，避免内容突然消失
    this._closeRaf = requestAnimationFrame(() => {
      const hide = () => {
        if (!this._open) this._listbox.hidden = true;
        this._listbox.removeEventListener('transitionend', hide);
      };
      this._listbox.addEventListener('transitionend', hide, { once: true });
      setTimeout(() => { if (!this._open) this._listbox.hidden = true; }, 160);
    });
  }

  _setFocus(index) {
    const items = this._listbox.querySelectorAll('.cs-option');
    if (!items.length) return;
    const clamped = Math.max(0, Math.min(items.length - 1, index));
    this._focusedIndex = clamped;
    items[clamped]?.focus();
  }

  _positionListbox() {
    const rect = this._trigger.getBoundingClientRect();
    const lb = this._listbox;
    const vH = window.innerHeight;
    const vW = window.innerWidth;

    // listbox 宽度：与 trigger 同宽（trigger 已设 min-width，足够容纳最长选项）
    lb.style.width = `${rect.width}px`;

    // 临时测量高度
    const prevHidden = lb.hidden;
    const prevVis = lb.style.visibility;
    lb.style.visibility = 'hidden';
    lb.hidden = false;
    const lbH = lb.scrollHeight;
    lb.hidden = prevHidden;
    lb.style.visibility = prevVis;

    const spaceBelow = vH - rect.bottom - 6;
    const openUp = spaceBelow < lbH && rect.top > spaceBelow;
    lb.classList.toggle('opens-up', openUp);

    // 左对齐 trigger，超出视口时往左移
    let left = rect.left;
    if (left + rect.width > vW - 8) left = vW - rect.width - 8;
    lb.style.left = `${Math.max(8, left)}px`;
    lb.style.top = openUp ? '' : `${rect.bottom + 2}px`;
    lb.style.bottom = openUp ? `${vH - rect.top + 2}px` : '';
  }

  _bind() {
    // trigger：mousedown 阻止冒泡，防止 _onOutside 干扰；click 切换开关
    this._trigger.addEventListener('mousedown', (e) => e.stopPropagation());
    this._trigger.addEventListener('click', () => {
      this._open ? this._close() : this._open_();
    });
    this._trigger.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this._open_();
      }
    });

    // listbox 键盘导航
    this._listbox.addEventListener('keydown', (e) => {
      const items = [...this._listbox.querySelectorAll('.cs-option')];
      switch (e.key) {
        case 'ArrowDown': e.preventDefault(); this._setFocus(this._focusedIndex + 1); break;
        case 'ArrowUp':   e.preventDefault(); this._setFocus(this._focusedIndex - 1); break;
        case 'Home':      e.preventDefault(); this._setFocus(0); break;
        case 'End':       e.preventDefault(); this._setFocus(items.length - 1); break;
        case 'Escape':    this._close(); break;
        case 'Tab':       this._close(false); break;
        default: break;
      }
    });

    // 点击外部关闭：capture 阶段捕获，不受 stopPropagation 影响
    this._onOutside = (e) => {
      if (!this._open) return;
      if (this._trigger.contains(e.target) || this._listbox.contains(e.target)) return;
      this._close(false);
    };
    document.addEventListener('mousedown', this._onOutside, true);

    // 窗口变化时更新下拉位置
    this._onResize = () => { if (this._open) this._positionListbox(); };
    window.addEventListener('resize', this._onResize, { passive: true });
    window.addEventListener('scroll', this._onResize, { passive: true, capture: true });
  }
}

export function initCustomSelect(wrapperSelector, opts = {}) {
  const wrapper = document.querySelector(wrapperSelector);
  if (!wrapper) throw new Error(`CustomSelect: 找不到 ${wrapperSelector}`);
  return new CustomSelect(
    wrapper.querySelector('.cs-trigger'),
    wrapper.querySelector('.cs-listbox'),
    opts
  );
}
