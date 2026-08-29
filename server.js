const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, 'public');
const uploadsDir = path.join(__dirname, 'uploads');

async function listBooks() {
  const files = await fs.promises.readdir(uploadsDir);
  return files.filter(file => /\.(pdf|epub)$/i.test(file));
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

// 本地预览直接读取 uploads；线上部署产物使用 /books/ 静态目录。
app.use('/books', express.static(uploadsDir));
app.use(express.static(publicDir));

// 兼容旧接口
app.get('/api/pdfs', (req, res) => {
  res.redirect('/api/books');
});

// 首页由 express.static(publicDir) 直接提供。

app.listen(PORT, () => {
  console.log(`PDF 阅读器运行在 http://localhost:${PORT}`);
});
