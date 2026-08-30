#!/usr/bin/env python3
"""
封面提取脚本
从 public/uploads/ 目录的书籍文件中提取封面，保存到 public/covers/
"""

import os
import sys
from pathlib import Path
from PIL import Image
import io

# 配置
SCRIPT_DIR = Path(__file__).parent
UPLOADS_DIR = SCRIPT_DIR.parent / 'public' / 'uploads'
COVERS_DIR = SCRIPT_DIR.parent / 'public' / 'covers'
THUMBNAIL_WIDTH = 300
JPEG_QUALITY = 85

# 确保 covers 目录存在
COVERS_DIR.mkdir(parents=True, exist_ok=True)

def get_cover_filename(book_file):
    """获取封面文件名（去除扩展名 + .jpg）"""
    return Path(book_file).stem + '.jpg'

def resize_image(image_data, output_path):
    """调整图片大小并保存为 JPEG"""
    try:
        img = Image.open(io.BytesIO(image_data))
        
        # 计算缩放比例
        if img.width > THUMBNAIL_WIDTH:
            ratio = THUMBNAIL_WIDTH / img.width
            new_height = int(img.height * ratio)
            img = img.resize((THUMBNAIL_WIDTH, new_height), Image.Resampling.LANCZOS)
        
        # 转换为 RGB（处理 RGBA 或其他模式）
        if img.mode in ('RGBA', 'LA', 'P'):
            background = Image.new('RGB', img.size, (255, 255, 255))
            if img.mode == 'P':
                img = img.convert('RGBA')
            background.paste(img, mask=img.split()[-1] if img.mode in ('RGBA', 'LA') else None)
            img = background
        elif img.mode != 'RGB':
            img = img.convert('RGB')
        
        # 保存为 JPEG
        img.save(output_path, 'JPEG', quality=JPEG_QUALITY, optimize=True)
        return True
    except Exception as e:
        print(f"    ✗ 图片处理失败: {e}")
        return False

def extract_pdf_cover(file_path, output_path):
    """从 PDF 提取首页作为封面"""
    try:
        import fitz  # PyMuPDF
        
        print(f"  正在提取 PDF 封面: {file_path.name}")
        
        doc = fitz.open(file_path)
        if doc.page_count == 0:
            print("    ✗ PDF 无页面")
            return False
        
        page = doc.load_page(0)  # 第一页
        
        # 渲染页面为图片
        mat = fitz.Matrix(2, 2)  # 2倍缩放获得更清晰的图片
        pix = page.get_pixmap(matrix=mat)
        
        # 转换为 PIL Image
        img_data = pix.tobytes("png")
        
        doc.close()
        
        # 调整大小并保存
        if resize_image(img_data, output_path):
            print(f"    ✓ PDF 封面提取成功")
            return True
        return False
        
    except ImportError:
        print("    ✗ 需要安装 PyMuPDF: pip install PyMuPDF")
        return False
    except Exception as e:
        print(f"    ✗ PDF 封面提取失败: {e}")
        return False

def extract_epub_cover(file_path, output_path):
    """从 EPUB 提取封面"""
    try:
        import ebooklib
        from ebooklib import epub
        
        print(f"  正在提取 EPUB 封面: {file_path.name}")
        
        book = epub.read_epub(file_path)
        
        # 尝试获取封面
        cover_item = None
        for item in book.get_items():
            if item.get_type() == ebooklib.ITEM_COVER:
                cover_item = item
                break
        
        # 如果没有专门的 cover item，尝试从 metadata 获取
        if not cover_item:
            for item in book.get_items_of_type(ebooklib.ITEM_IMAGE):
                # 检查文件名是否包含 cover 关键词
                if 'cover' in item.get_name().lower():
                    cover_item = item
                    break
        
        if not cover_item:
            print("    ✗ 未找到封面")
            return False
        
        # 保存封面
        img_data = cover_item.get_content()
        
        if resize_image(img_data, output_path):
            print(f"    ✓ EPUB 封面提取成功")
            return True
        return False
        
    except ImportError:
        print("    ✗ 需要安装 ebooklib: pip install ebooklib")
        return False
    except Exception as e:
        print(f"    ✗ EPUB 封面提取失败: {e}")
        return False

def extract_mobi_cover(file_path, output_path):
    """从 MOBI 提取封面（使用 mobi 库）"""
    try:
        import mobi
        
        print(f"  正在提取 MOBI 封面: {file_path.name}")
        
        # 解压 MOBI
        tempdir, filepath = mobi.extract(file_path)
        
        # 查找封面图片
        cover_path = None
        for root, dirs, files in os.walk(tempdir):
            for file in files:
                if 'cover' in file.lower() and file.lower().endswith(('.jpg', '.jpeg', '.png', '.gif')):
                    cover_path = os.path.join(root, file)
                    break
            if cover_path:
                break
        
        if not cover_path:
            print("    ✗ 未找到封面")
            return False
        
        # 读取并处理封面
        with open(cover_path, 'rb') as f:
            img_data = f.read()
        
        # 清理临时文件
        import shutil
        shutil.rmtree(tempdir, ignore_errors=True)
        
        if resize_image(img_data, output_path):
            print(f"    ✓ MOBI 封面提取成功")
            return True
        return False
        
    except ImportError:
        print("    ✗ 需要安装 mobi: pip install mobi")
        return False
    except Exception as e:
        print(f"    ✗ MOBI 封面提取失败: {e}")
        return False

def main():
    print("=" * 60)
    print("封面提取工具")
    print("=" * 60)
    print()
    
    if not UPLOADS_DIR.exists():
        print(f"✗ 书籍目录不存在: {UPLOADS_DIR}")
        sys.exit(1)
    
    # 查找所有书籍文件
    book_files = []
    for ext in ['.pdf', '.epub', '.mobi']:
        book_files.extend(UPLOADS_DIR.glob(f'*{ext}'))
        book_files.extend(UPLOADS_DIR.glob(f'*{ext.upper()}'))
    
    if not book_files:
        print("未找到任何书籍文件")
        return
    
    print(f"找到 {len(book_files)} 个书籍文件\n")
    
    success_count = 0
    skip_count = 0
    fail_count = 0
    
    for book_file in book_files:
        cover_filename = get_cover_filename(book_file.name)
        output_path = COVERS_DIR / cover_filename
        
        # 如果封面已存在，跳过
        if output_path.exists():
            print(f"- 封面已存在，跳过: {book_file.name}")
            skip_count += 1
            continue
        
        ext = book_file.suffix.lower()
        success = False
        
        if ext == '.pdf':
            success = extract_pdf_cover(book_file, output_path)
        elif ext == '.epub':
            success = extract_epub_cover(book_file, output_path)
        elif ext == '.mobi':
            success = extract_mobi_cover(book_file, output_path)
        
        if success:
            success_count += 1
        else:
            fail_count += 1
        
        print()
    
    print("=" * 60)
    print(f"完成！成功: {success_count}, 跳过: {skip_count}, 失败: {fail_count}")
    print("=" * 60)
    
    if fail_count > 0:
        print("\n提示：")
        print("- 对于失败的书籍，可以手动截图或使用 Calibre 等工具提取封面")
        print("- 将封面图片放到 public/covers/ 目录，文件名与书籍一致（扩展名为 .jpg）")

if __name__ == '__main__':
    main()
