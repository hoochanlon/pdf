// i18n 国际化模块
// 支持中文（zh-CN）、日文（ja-JP）、英文（en-US）

const translations = {};
let currentLanguage = 'zh-CN'; // 默认语言

// 自定义事件名：不能叫 'languagechange'，那是浏览器原生事件名（navigator.language 变化时触发），
// 两者共用 window.addEventListener('languagechange', ...) 会被浏览器/系统语言设置变化意外触发。
export const LANGUAGE_CHANGE_EVENT = 'app:languagechange';

// 支持的语言列表
export const supportedLanguages = [
  { code: 'zh-CN', name: '中文', icon: './icons/china.svg' },
  { code: 'ja-JP', name: '日本語', icon: './icons/jp.svg' },
  { code: 'en-US', name: 'English', icon: './icons/us.svg' }
];

const CACHE_PREFIX = 'i18n-cache-';

function readCachedTranslations(lang) {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${lang}`);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function writeCachedTranslations(lang, data) {
  try {
    localStorage.setItem(`${CACHE_PREFIX}${lang}`, JSON.stringify(data));
  } catch (e) {
    // 存储配额不足或被禁用时静默忽略，不影响功能
  }
}

async function fetchTranslations(lang) {
  const response = await fetch(`./locales/${lang}.json`);
  if (!response.ok) throw new Error(`Failed to load ${lang}.json`);
  return response.json();
}

// 加载翻译文件
// 刷新页面时如果每次都等 fetch 完成才应用翻译，会先闪一下默认的中文静态文案。
// 这里优先同步读取本地缓存立即返回（几乎无延迟），同时在后台静默拉取最新版本刷新缓存，
// 避免每次刷新都出现「先中文、再切换为目标语言」的闪烁。
async function loadTranslations(lang) {
  if (translations[lang]) return translations[lang];

  const cached = readCachedTranslations(lang);
  if (cached) {
    translations[lang] = cached;
    fetchTranslations(lang).then((data) => {
      translations[lang] = data;
      writeCachedTranslations(lang, data);
    }).catch(() => {});
    return cached;
  }

  try {
    const data = await fetchTranslations(lang);
    translations[lang] = data;
    writeCachedTranslations(lang, data);
    return data;
  } catch (error) {
    console.error(`Failed to load translations for ${lang}:`, error);
    // 回退到默认语言
    if (lang !== 'zh-CN') {
      return loadTranslations('zh-CN');
    }
    return {};
  }
}

// 获取翻译文本
export function t(key, fallback = key, params = {}) {
  const keys = key.split('.');
  let value = translations[currentLanguage];
  
  for (const k of keys) {
    if (value && typeof value === 'object') {
      value = value[k];
    } else {
      return fallback;
    }
  }
  
  let result = value || fallback;
  
  // 替换占位符 {param}
  Object.keys(params).forEach(param => {
    result = result.replace(`{${param}}`, params[param]);
  });
  
  return result;
}

// 设置语言
export async function setLanguage(lang) {
  if (!supportedLanguages.find(l => l.code === lang)) {
    console.warn(`Unsupported language: ${lang}`);
    return false;
  }
  
  await loadTranslations(lang);
  currentLanguage = lang;
  
  // 保存到 localStorage
  try {
    localStorage.setItem('app-language', lang);
  } catch (e) {
    console.warn('Failed to save language preference:', e);
  }
  
  // 更新 HTML lang 属性
  document.documentElement.lang = lang;
  
  // 触发语言变更事件（自定义事件名，避免与浏览器原生 languagechange 事件冲突）
  window.dispatchEvent(new CustomEvent(LANGUAGE_CHANGE_EVENT, { detail: { lang } }));
  
  return true;
}

// 获取当前语言
export function getCurrentLanguage() {
  return currentLanguage;
}

// 初始化 i18n
export async function initI18n() {
  // 从 localStorage 读取保存的语言偏好
  let savedLang = 'zh-CN';
  try {
    savedLang = localStorage.getItem('app-language') || 'zh-CN';
  } catch (e) {
    console.warn('Failed to read language preference:', e);
  }
  
  // 检测浏览器语言
  const browserLang = navigator.language || navigator.userLanguage;
  const matchedLang = supportedLanguages.find(l => 
    l.code === browserLang || l.code.startsWith(browserLang.split('-')[0])
  );
  
  // 优先使用保存的语言，其次使用浏览器语言，最后使用默认语言
  const initialLang = savedLang !== 'zh-CN' ? savedLang : 
                    (matchedLang ? matchedLang.code : 'zh-CN');
  
  await setLanguage(initialLang);
}

// 批量更新 DOM 元素的文本内容
export function updateDOMTranslations() {
  // 更新所有带有 data-i18n 属性的元素
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const key = element.getAttribute('data-i18n');
    const translation = t(key);
    
    if (translation) {
      element.textContent = translation;
    }
  });
  
  // 更新所有带有 data-i18n-placeholder 属性的输入框
  document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
    const key = element.getAttribute('data-i18n-placeholder');
    const translation = t(key);
    
    if (translation) {
      element.placeholder = translation;
    }
  });
  
  // 更新所有带有 data-i18n-title 属性的元素
  document.querySelectorAll('[data-i18n-title]').forEach(element => {
    const key = element.getAttribute('data-i18n-title');
    const translation = t(key);
    
    if (translation) {
      element.title = translation;
    }
  });
  
  // 更新所有带有 data-i18n-aria-label 属性的元素
  document.querySelectorAll('[data-i18n-aria-label]').forEach(element => {
    const key = element.getAttribute('data-i18n-aria-label');
    const translation = t(key);
    
    if (translation) {
      element.setAttribute('aria-label', translation);
    }
  });
}

// 监听语言变更事件，自动更新 DOM
if (typeof window !== 'undefined') {
  window.addEventListener(LANGUAGE_CHANGE_EVENT, updateDOMTranslations);
}