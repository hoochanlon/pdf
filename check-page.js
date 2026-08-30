const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: true
  });
  
  const page = await browser.newPage();
  
  // 收集控制台日志
  const consoleLogs = [];
  page.on('console', msg => {
    consoleLogs.push({
      type: msg.type(),
      text: msg.text(),
      location: msg.location()
    });
  });
  
  // 收集错误
  const pageErrors = [];
  page.on('pageerror', error => {
    pageErrors.push({
      message: error.message,
      stack: error.stack
    });
  });
  
  try {
    console.log('=== 开始检查 ===');
    
    // 1. 打开页面
    console.log('1. 正在打开 http://localhost:3000');
    await page.goto('http://localhost:3000', { 
      waitUntil: 'networkidle2',
      timeout: 10000
    });
    
    // 2. 等待3秒
    console.log('2. 等待页面加载完成（3秒）');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // 4. 截图
    console.log('4. 截图当前页面');
    await page.screenshot({ path: 'page-screenshot.png', fullPage: true });
    console.log('   截图已保存到: page-screenshot.png');
    
    // 6. 检查左侧书架区域
    console.log('6. 检查左侧书架区域');
    const bookshelfExists = await page.$('.bookshelf') !== null;
    const bookItems = await page.$$('.book-item');
    console.log(`   书架区域存在: ${bookshelfExists}`);
    console.log(`   书籍数量: ${bookItems.length}`);
    
    // 获取书架内容
    const bookshelfContent = await page.evaluate(() => {
      const bookshelf = document.querySelector('.bookshelf');
      if (!bookshelf) return null;
      
      const books = Array.from(document.querySelectorAll('.book-item')).map(book => {
        return {
          title: book.querySelector('.book-title')?.textContent || '',
          visible: book.offsetParent !== null
        };
      });
      
      return {
        exists: true,
        booksCount: books.length,
        books: books.slice(0, 5) // 只取前5个
      };
    });
    
    console.log('   书架内容:', JSON.stringify(bookshelfContent, null, 2));
    
    // 5 & 7. 检查控制台输出和错误
    console.log('\n=== Console 输出 ===');
    if (consoleLogs.length === 0) {
      console.log('Console 无输出');
    } else {
      console.log(`Console 共有 ${consoleLogs.length} 条日志`);
      const last10 = consoleLogs.slice(-10);
      console.log('最后10条日志:');
      last10.forEach((log, index) => {
        console.log(`[${log.type}] ${log.text}`);
      });
    }
    
    console.log('\n=== 页面错误 ===');
    if (pageErrors.length === 0) {
      console.log('无页面错误');
    } else {
      console.log(`共有 ${pageErrors.length} 个错误:`);
      pageErrors.forEach((error, index) => {
        console.log(`错误 ${index + 1}:`);
        console.log(`  消息: ${error.message}`);
        console.log(`  堆栈: ${error.stack}`);
      });
    }
    
  } catch (error) {
    console.error('检查过程中出错:', error.message);
    console.error('堆栈:', error.stack);
  } finally {
    await browser.close();
    console.log('\n=== 检查完成 ===');
  }
})();
