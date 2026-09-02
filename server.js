const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, 'public');
const uploadsDir = path.join(publicDir, 'uploads');

async function listBooksRecursive(dir, baseDir = dir) {
  const books = [];
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      // 递归扫描子文件夹
      const subBooks = await listBooksRecursive(fullPath, baseDir);
      books.push(...subBooks);
    } else if (entry.isFile() && /\.(pdf|epub|mobi|azw3?)$/i.test(entry.name)) {
      // 计算相对路径，按层级解析「类型 / 分类」
      const relativePath = path.relative(baseDir, dir).replace(/\\/g, '/');
      const parts = relativePath ? relativePath.split('/') : [];
      let type, category;
      if (parts.length === 0) {
        // 根目录文件
        type = '图书';
        category = '未分类';
      } else if (parts.length === 1) {
        // 兼容旧结构：只有一层时默认为「图书」
        type = '图书';
        category = parts[0];
      } else {
        // 两层及以上：第一层为类型，其余为分类
        type = parts[0];
        category = parts.slice(1).join('/');
      }
      
      books.push({
        file: path.relative(baseDir, fullPath).replace(/\\/g, '/'),
        type,
        category
      });
    }
  }
  
  return books;
}

async function listBooks() {
  try {
    return await listBooksRecursive(uploadsDir);
  } catch (error) {
    console.error('扫描书籍失败:', error);
    return [];
  }
}

// 本地动态生成清单；线上由 GitHub Actions 在部署阶段生成同名 books.json。
app.get('/books.json', async (req, res) => {
  try {
    // 先动态扫描所有书籍
    const scannedBooks = await listBooks();
    
    // 尝试读取静态配置的元数据覆盖
    const staticBooksPath = path.join(publicDir, 'books.json');
    let metadataOverrides = {};
    
    try {
      const staticContent = await fs.promises.readFile(staticBooksPath, 'utf-8');
      const staticBooks = JSON.parse(staticContent);
      
      // 将静态配置转换为以 file 为 key 的映射
      if (Array.isArray(staticBooks)) {
        staticBooks.forEach(book => {
          if (book.file) {
            metadataOverrides[book.file] = book;
          }
        });
      }
    } catch (err) {
      // 静态文件不存在或解析失败，忽略
    }
    
    // 合并：动态扫描的书籍 + 静态配置的元数据覆盖
    const mergedBooks = scannedBooks.map(book => {
      const override = metadataOverrides[book.file];
      return override ? { ...book, ...override } : book;
    });
    
    res.json(mergedBooks);
  } catch (error) {
    res.status(500).json({ error: '读取 uploads 失败' });
  }
});

// 兼容旧接口：本地从 uploads 返回书籍清单。
app.get('/api/books', async (req, res) => {
  try {
    res.json(await listBooks());
  } catch (error) {
    res.status(500).json({ error: '读取 uploads 失败' });
  }
});

// 本地和线上都从 public/uploads 读取书籍。
app.use(express.static(publicDir));

// 兼容旧接口
app.get('/api/pdfs', (req, res) => {
  res.redirect('/api/books');
});

// 首页由 express.static(publicDir) 直接提供。

app.listen(PORT, () => {
  console.log(`PDF 阅读器运行在 http://localhost:${PORT}`);
});
