#!/usr/bin/env python3
"""
书籍封面自动提取脚本
支持 PDF、EPUB 格式
"""

import os
import sys
from pathlib import Path
from PIL import Image
import fitz  # PyMuPDF
from ebooklib import epub

UPLOADS_DIR = Path(__file__).parent.parent / "public" / "uploads"
COVERS_DIR = Path(__file__).parent.parent / "public" / "covers"
THUMBNAIL_WIDTH = 300
JPEG_QUALITY = 85

# 确保封面目录存在
COVERS_DIR.mkdir(parents=True, exist_ok=True)


def get_cover_path(book_file):
    """获取封面文件路径"""
    stem = book_file.stem
    return COVERS_DIR / f"{stem}.jpg"


def extract_pdf_cover(pdf_path, output_path):
    """从 PDF 提取首页作为封面"""
    try:
        print(f"  提取 PDF 封面: {pdf_path.name}")
        doc = fitz.open(pdf_path)
        
        if doc.page_count == 0:
            print(f"  ✗ PDF 无页面: {pdf_path.name}")
            return False
        
        page = doc[0]
        
        # 渲染首页为图片
        mat = fitz.Matrix(2.0, 2.0)  # 2倍分辨率
        pix = page.get_pixmap(matrix=mat)
        
        # 转换为 PIL Image
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        
        # 调整尺寸
        aspect_ratio = img.height / img.width
        new_height = int(THUMBNAIL_WIDTH * aspect_ratio)
        img = img.resize((THUMBNAIL_WIDTH, new_height), Image.Resampling.LANCZOS)
        
        # 保存为 JPEG
        img.save(output_path, "JPEG", quality=JPEG_QUALITY, optimize=True)
        
        doc.close()
        print(f"  ✓ PDF 封面提取成功: {pdf_path.name}")
        return True
        
    except Exception as e:
        print(f"  ✗ PDF 封面提取失败: {pdf_path.name} - {e}")
        return False


def extract_epub_cover(epub_path, output_path):
    """从 EPUB 提取封面"""
    try:
        print(f"  提取 EPUB 封面: {epub_path.name}")
        book = epub.read_epub(epub_path)
        
        # 尝试获取封面
        cover_id = None
        for item in book.get_items():
            if item.get_type() == 9:  # 9 = ITEM_COVER_IMAGE
                cover_id = item
                break
        
        if not cover_id:
            # 尝试从 metadata 获取封面引用
            for meta in book.get_metadata('OPF', 'cover'):
                cover_id = meta[0]
                break
        
        if not cover_id:
            print(f"  ✗ EPUB 未找到封面: {epub_path.name}")
            return False
        
        # 获取封面图片数据
        if hasattr(cover_id, 'get_content'):
            cover_data = cover_id.get_content()
        else:
            cover_item = book.get_item_with_id(cover_id)
            if not cover_item:
                print(f"  ✗ EPUB 封面数据获取失败: {epub_path.name}")
                return False
            cover_data = cover_item.get_content()
        
        # 使用 PIL 处理图片
        from io import BytesIO
        img = Image.open(BytesIO(cover_data))
        
        # 转换为 RGB（处理 RGBA 或其他格式）
        if img.mode != 'RGB':
            img = img.convert('RGB')
        
        # 调整尺寸
        aspect_ratio = img.height / img.width
        new_height = int(THUMBNAIL_WIDTH * aspect_ratio)
        img = img.resize((THUMBNAIL_WIDTH, new_height), Image.Resampling.LANCZOS)
        
        # 保存为 JPEG
        img.save(output_path, "JPEG", quality=JPEG_QUALITY, optimize=True)
        
        print(f"  ✓ EPUB 封面提取成功: {epub_path.name}")
        return True
        
    except Exception as e:
        print(f"  ✗ EPUB 封面提取失败: {epub_path.name} - {e}")
        return False


def extract_mobi_cover(mobi_path, output_path):
    """MOBI 格式暂不支持"""
    print(f"  ⚠ MOBI 封面提取暂不支持: {mobi_path.name}")
    print(f"    建议：使用 Calibre 转换为 EPUB 或手动提取封面")
    return False


def main():
    print("开始自动提取书籍封面...\n")
    
    if not UPLOADS_DIR.exists():
        print(f"错误: uploads 目录不存在 - {UPLOADS_DIR}")
        sys.exit(1)
    
    # 查找所有书籍文件
    book_files = []
    for ext in ['*.pdf', '*.epub', '*.mobi']:
        book_files.extend(UPLOADS_DIR.glob(ext))
    
    if not book_files:
        print("未找到书籍文件")
        return
    
    print(f"找到 {len(book_files)} 个书籍文件\n")
    
    success_count = 0
    skip_count = 0
    fail_count = 0
    
    for book_file in book_files:
        cover_path = get_cover_path(book_file)
        
        # 如果封面已存在，跳过
        if cover_path.exists():
            print(f"- 封面已存在，跳过: {book_file.name}")
            skip_count += 1
            continue
        
        ext = book_file.suffix.lower()
        success = False
        
        if ext == '.pdf':
            success = extract_pdf_cover(book_file, cover_path)
        elif ext == '.epub':
            success = extract_epub_cover(book_file, cover_path)
        elif ext == '.mobi':
            success = extract_mobi_cover(book_file, cover_path)
        
        if success:
            success_count += 1
        else:
            fail_count += 1
    
    print(f"\n完成！")
    print(f"  成功: {success_count}")
    print(f"  跳过: {skip_count}")
    print(f"  失败: {fail_count}")
    
    if fail_count > 0:
        print(f"\n对于失败的封面，你可以：")
        print(f"1. 手动放置封面图片到 public/covers/ 目录")
        print(f"2. 使用 Calibre 等工具提取封面")


if __name__ == "__main__":
    main()
