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

## 自动提取封面（推荐）

### 方法1：使用 Python 脚本（本地批量提取）

项目提供了自动提取脚本，支持 PDF、EPUB、MOBI 三种格式。

**步骤：**

1. 安装 Python 依赖：
```bash
pip install -r requirements.txt
```

2. 运行提取脚本：
```bash
python scripts/extract_covers.py
```

脚本会自动：
- 扫描 `public/uploads/` 目录下的所有书籍
- 提取封面并保存到 `public/covers/`
- 自动调整大小（宽度 300px）并优化压缩
- 跳过已有封面的书籍

**支持的提取方式：**
- **PDF**: 提取第一页
- **EPUB**: 从 metadata 或内嵌图片提取
- **MOBI**: 从解压后的文件中查找封面

3. 提交封面到 git：
```bash
git add public/covers/*.jpg
git commit -m "添加书籍封面"
git push
```

## 手动添加封面

如果自动提取失败，可以手动添加封面：

### 方法2：使用 Calibre 批量提取

```bash
# 安装 Calibre
# macOS: brew install --cask calibre
# 或从官网下载: https://calibre-ebook.com/download

# 提取封面（示例）
ebook-meta "书籍文件.pdf" --get-cover="封面.jpg"
```

### 方法3：手动截图/导出

1. 使用 PDF 阅读器打开书籍，截取首页
2. 将封面图片重命名并保存到 `public/covers/` 目录
3. 推荐尺寸：宽度 300-600px，JPEG 格式

### 方法4：使用在线工具

- PDF: https://www.ilovepdf.com/
- EPUB: 使用在线转换器提取封面

## 部署说明

### Git 管理策略

- ✅ **提交**: 封面图片（`public/covers/*.jpg`）
- ❌ **忽略**: 书籍文件（`public/uploads/*.pdf|epub|mobi`）

### 线上部署流程

1. 本地运行 `python scripts/extract_covers.py` 提取封面
2. 将封面图片提交到 git 仓库
3. 书籍文件通过以下方式上传到服务器：
   - 云存储（推荐）：OSS/S3/CDN
   - 服务器直接上传
   - FTP/SFTP

## 优势

- 封面图片体积小（几十KB），适合 git 管理
- 书籍文件体积大（几MB-几十MB），通过其他方式管理更合理
- 前端直接加载静态图片，无需在浏览器端动态提取（性能更好）
- 离线缓存更可靠

## 故障排查

**Q: Python 脚本报错 "需要安装 XXX"**

A: 运行 `pip install -r requirements.txt` 安装所有依赖

**Q: MOBI 封面提取失败**

A: MOBI 格式较复杂，建议使用 Calibre 手动提取，或将 MOBI 转换为 EPUB 后再提取

**Q: 提取的封面图片过大**

A: 脚本会自动压缩到宽度 300px，质量 85%。如需调整，修改脚本中的 `THUMBNAIL_WIDTH` 和 `JPEG_QUALITY` 参数
