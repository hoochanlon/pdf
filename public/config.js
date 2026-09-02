// 应用配置文件
// 修改此文件以自定义你的在线阅读器

export const config = {
  // 网站信息
  // 标题/副标题现在由 public/locales/*.json 里的 site.title / site.subtitle 提供，会跟随语言切换自动更新。
  // 若需要自定义品牌文案，请直接修改那三个文件里对应语言的 site.title / site.subtitle。
  site: {
    favicon: null  // 可选：设置 favicon 路径
  },

  // 书架配置
  library: {
    heading: '我的书架',
    eyebrow: 'LIBRARY'
  },

  // 社交链接配置
  // 设置为 null 或空字符串可隐藏对应图标
  social: {
    github: {
      url: 'https://github.com/hoochanlon',
      enabled: true
    },
    bluesky: {
      url: 'https://bsky.app/profile/hoochanlon.bsky.social',
      enabled: true
    },
    email: {
      url: 'mailto:hoochanlon@outlook.com',
      enabled: true
    }
  },

  // UI 配置
  ui: {
    // 默认侧边栏状态（桌面端）
    sidebarDefaultCollapsed: false,

    // 是否显示书籍数量
    showBookCount: false,

    // 默认 EPUB 阅读模式：'scroll' 或 'paginated'
    defaultEpubMode: 'paginated'
  },

  // i18n 国际化配置
  i18n: {
    // 默认语言：'zh-CN', 'ja-JP', 'en-US'
    defaultLanguage: 'zh-CN',
    
    // 是否自动检测浏览器语言
    autoDetectLanguage: true
  }
};
