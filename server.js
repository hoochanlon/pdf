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
      // 计算相对路径作为分类
      const relativePath = path.relative(baseDir, dir);
      const category = relativePath || '未分类';
      
      books.push({
        file: path.relative(baseDir, fullPath).replace(/\\/g, '/'), // 使用相对路径
        category: category.replace(/\\/g, '/') // 分类名
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
    res.json(await listBooks());
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
