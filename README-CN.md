# 在线电子书阅读器

一个基于 Node.js + Express 的本地在线阅读器，支持 PDF、EPUB、MOBI、AZW3 格式。

## 截图

在线阅读，同时也适合本地临时文件阅读。

![](./screenshots/1.png)

## 运行方式

### 1. 放置电子书文件

将书籍文件放入项目中的 `public/uploads` 目录中，按目录层级自动识别分类，例如：

```text
public/uploads/
├── 图书/
│   ├── 小说/
│   │   └── 示例小说.epub
│   └── 历史/
│       └── 中国史.pdf
├── 论文/
│   └── 经济学/
│       └── 论文示例.pdf
```

服务端会递归扫描 `public/uploads` 下的文件，自动生成 `/books.json` 和书架列表。

> [!note]
>
> 为了获得更好的自动识别效果，建议按以下格式命名：
>
> ```text
> 《书名》-作者.pdf
> 《书名》-作者.epub
> 《书名》-作者.mobi
> ```
>
> 系统会自动提取标题、作者和分类信息。

### 2. 启动

一键启动

```bash
npm install && npm start
```

终结进程

```bash
sudo kill $(sudo lsof -t -i:3000) 2>/dev/null
```

## 生产/部署建议

- 适合本地部署到 NAS、家庭服务器或私有云环境
- 适合静态托管场景，但需要确保 `public/uploads` 中的文件能被 Web 服务器访问
- 若要部署到远程主机，请确认目录权限和文件路径的一致性


## 参考项目

- Calibre：https://calibre.online
- Foliate.js：https://github.com/johnfactotum/foliate-js
- Flowoss：https://www.flowoss.com
- PDF Gear：https://www.pdfgear.com

## 下一步计划

其他细节方面的优化
