const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// 静态文件服务
app.use('/uploads', express.static('uploads'));
app.use('/public', express.static('public'));

// 获取书籍列表（PDF + EPUB）
app.get('/api/books', (req, res) => {
  const uploadsDir = path.join(__dirname, 'uploads');

  fs.readdir(uploadsDir, (err, files) => {
    if (err) {
      return res.status(500).json({ error: '读取文件夹失败' });
    }

    const bookFiles = files.filter(file =>
      /\.(pdf|epub)$/i.test(file)
    );
    res.json(bookFiles);
  });
});

// 兼容旧接口
app.get('/api/pdfs', (req, res) => {
  res.redirect('/api/books');
});

// 首页
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`PDF 阅读器运行在 http://localhost:${PORT}`);
});
