# 封面图片管理说明

## 目录结构

```
public/
  ├── covers/          # 封面图片目录（需提交到 git）
  │   ├── 书名.jpg
  │   └── ...
  └── uploads/         # 书籍文件目录（不提交到 git）
      ├── .gitkeep
      ├── 书名.pdf
      └── ...
```

## 封面图片命名规则

封面图片应放置在 `public/covers/` 目录下，文件名与书籍文件名一致（去除扩展名 + .jpg）。

示例：
- 书籍文件: `存在与荒谬-潘绥铭.mobi`
- 封面图片: `存在与荒谬-潘绥铭.jpg`

## 如何添加封面

### 方法1：手动截图/导出

1. 使用 PDF 阅读器打开书籍，截取首页
2. 或使用专业工具（如 Calibre）导出封面
3. 将封面图片重命名并保存到 `public/covers/` 目录
4. 推荐尺寸：宽度 300-600px，JPEG 格式

### 方法2：使用 Calibre 批量提取

```bash
# 安装 Calibre
# macOS: brew install --cask calibre
# 或从官网下载: https://calibre-ebook.com/download

# 提取封面（示例）
ebook-meta "书籍文件.pdf" --get-cover="封面.jpg"
```

### 方法3：使用在线工具

- PDF: https://www.ilovepdf.com/
- EPUB: 使用在线转换器提取封面

## 部署说明

### Git 管理策略

- ✅ **提交**: 封面图片（`public/covers/*.jpg`）
- ❌ **忽略**: 书籍文件（`public/uploads/*.pdf|epub|mobi`）

### 线上部署流程

1. 将封面图片提交到 git 仓库
2. 书籍文件通过以下方式上传：
   - 云存储（推荐）：OSS/S3/CDN
   - 服务器直接上传
   - FTP/SFTP

## 优势

- 封面图片体积小（几十KB），适合 git 管理
- 书籍文件体积大（几MB-几十MB），通过其他方式管理更合理
- 前端直接加载静态图片，无需在浏览器端动态提取（性能更好）
- 离线缓存更可靠
