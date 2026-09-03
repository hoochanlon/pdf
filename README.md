# Online Ebook Reader

[中文](./README-CN.md)

A local web-based ebook reader built with Node.js and Express. It supports PDF, EPUB, MOBI, and AZW3 files.

## Features

- Read PDF, EPUB, MOBI, and AZW3 books in a web browser
- Automatically scan books from `public/uploads`
- Organize books by directory structure and generate library categories
- Display book metadata and reading progress
- Support local deployment on a computer, NAS, home server, or private cloud

## Screenshot

Read books online or use the reader to open files hosted locally.

![Reader screenshot](./screenshots/1.png)

## Getting Started

### 1. Add ebook files

Place your ebook files inside the project's `public/uploads` directory. The server recursively scans this directory and uses its folder structure to determine book types and categories.

For example:

```text
public/uploads/
├── Books/
│   ├── Fiction/
│   │   └── Example Novel.epub
│   └── History/
│       └── Chinese History.pdf
├── Papers/
│   └── Economics/
│       └── Example Paper.pdf
```

The server automatically generates `/books.json` and uses it to populate the library.

For better automatic metadata detection, use a filename format such as:

```text
Book Title - Author.pdf
Book Title - Author.epub
Book Title - Author.mobi
```

The reader can extract the title, author, and category information from the filename and directory structure.

### 2. Install dependencies and start the server

```bash
npm install && npm start
```

Then open the following address in your browser:

```text
http://localhost:3000
```


## Deployment Notes

- The project is suitable for local deployment on a NAS, home server, or private cloud.
- When using a static hosting service, make sure files under `public/uploads` are available to the web server.
- For remote deployment, verify directory permissions and ensure that the configured file paths remain consistent.
- Do not expose personal or copyrighted ebook files to the public internet without proper authorization.

## References

- [Foliate.js](https://github.com/johnfactotum/foliate-js)
- [Calibre](https://calibre.online)
- [Flowoss](https://www.flowoss.com)
- [PDF Gear](https://www.pdfgear.com)
