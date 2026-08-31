# 在线电子书预览器

仅做到在线预览 pdf、epub、mobi 三类格式常见预览：

https://github.com/hoochanlon/pdf

专业的阅读工具，如下：

* https://www.pdfgear.com
* https://calibre.online

常规的格式：

* https://www.flowoss.com
* https://github.com/johnfactotum/foliate-js

```
# 安装 Calibre
brew install --cask calibre  # macOS

# 提取封面
ebook-meta "书籍.mobi" --get-cover="封面.jpg"
```

## 下一步计划

* [ ] 更新书架书籍加载、刷新、完成后的动画效果（消除刷新闪烁问题）
* [ ] epub、pdf、mobi 工具栏界面增加下载按钮 （方便下载）
* [ ] 支持本地 PDF、epub、mobi 阅读 （方便本地阅读）
