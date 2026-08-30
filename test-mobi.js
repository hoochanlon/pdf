const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

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
  const errors = [];
  page.on('pageerror', error => {
    errors.push({
      message: error.message,
      stack: error.stack
    });
  });

  try {
    console.log('=== 开始测试 ===\n');
    
    // 1. 打开页面
    console.log('1. 打开 http://localhost:3000');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
    console.log('   页面加载完成\n');

    // 2. 找到并点击书籍
    console.log('2. 查找并点击"存在与荒谬"');
    const bookLink = await page.locator('text=存在与荒谬').first();
    
    if (await bookLink.count() === 0) {
      console.log('   ❌ 未找到该书籍，查看所有书籍链接：');
      const allBooks = await page.locator('.book-item').allTextContents();
      console.log('   可用书籍：', allBooks);
    } else {
      await bookLink.click();
      console.log('   ✓ 已点击书籍\n');
    }

    // 3. 等待 5 秒
    console.log('3. 等待 5 秒观察页面反应');
    await page.waitForTimeout(5000);
    console.log('   等待完成\n');

    // 4. 检查 mobi-container 元素
    console.log('4. 检查 id="mobi-container" 的元素');
    const mobiContainer = await page.locator('#mobi-container');
    const containerExists = await mobiContainer.count() > 0;
    console.log(`   元素存在: ${containerExists}`);
    
    if (containerExists) {
      const containerHTML = await mobiContainer.innerHTML();
      const containerText = await mobiContainer.innerText();
      console.log(`   HTML 长度: ${containerHTML.length} 字符`);
      console.log(`   文本内容: ${containerText.substring(0, 200)}${containerText.length > 200 ? '...' : ''}`);
    }
    console.log('');

    // 5. 检查 mobi-status 状态
    console.log('5. 检查 id="mobi-status" 的状态提示');
    const mobiStatus = await page.locator('#mobi-status');
    const statusExists = await mobiStatus.count() > 0;
    console.log(`   元素存在: ${statusExists}`);
    
    if (statusExists) {
      const statusText = await mobiStatus.innerText();
      const statusClass = await mobiStatus.getAttribute('class');
      console.log(`   状态文本: ${statusText}`);
      console.log(`   CSS 类: ${statusClass}`);
    }
    console.log('');

    // 6. 获取页面标题和 URL
    console.log('6. 当前页面信息');
    const pageTitle = await page.title();
    const pageURL = page.url();
    console.log(`   标题: ${pageTitle}`);
    console.log(`   URL: ${pageURL}\n`);

    // 7. 检查页面上的关键元素
    console.log('7. 检查页面关键元素');
    const readerVisible = await page.locator('#reader').isVisible().catch(() => false);
    const sidebarVisible = await page.locator('#sidebar').isVisible().catch(() => false);
    console.log(`   #reader 可见: ${readerVisible}`);
    console.log(`   #sidebar 可见: ${sidebarVisible}\n`);

    // 8. 截图
    console.log('8. 截图当前页面');
    await page.screenshot({ 
      path: '/Users/chanlonhoo/Documents/GitHub/pdf/screenshot.png',
      fullPage: true 
    });
    console.log('   ✓ 截图已保存到 screenshot.png\n');

    // 9. 输出控制台日志
    console.log('=== 控制台日志 ===');
    if (consoleLogs.length === 0) {
      console.log('(无控制台输出)');
    } else {
      consoleLogs.forEach((log, index) => {
        console.log(`[${log.type}] ${log.text}`);
      });
    }
    console.log('');

    // 10. 输出错误信息
    console.log('=== 错误信息 ===');
    if (errors.length === 0) {
      console.log('(无 JavaScript 错误)');
    } else {
      errors.forEach((error, index) => {
        console.log(`错误 ${index + 1}:`);
        console.log(`  消息: ${error.message}`);
        console.log(`  堆栈: ${error.stack}\n`);
      });
    }
    console.log('');

    // 11. 执行 JavaScript 获取更多信息
    console.log('=== JavaScript 检查 ===');
    const jsInfo = await page.evaluate(() => {
      return {
        hasOnerror: typeof window.onerror !== 'undefined',
        mobiContainerContent: document.getElementById('mobi-container')?.innerHTML || 'null',
        mobiStatusContent: document.getElementById('mobi-status')?.innerHTML || 'null',
        documentTitle: document.title,
        bodyClasses: document.body.className,
        visibleText: document.body.innerText.substring(0, 500)
      };
    });
    console.log('window.onerror 已定义:', jsInfo.hasOnerror);
    console.log('mobi-container HTML:', jsInfo.mobiContainerContent.substring(0, 300));
    console.log('mobi-status HTML:', jsInfo.mobiStatusContent);
    console.log('页面可见文本（前500字符）:');
    console.log(jsInfo.visibleText);
    console.log('');

    console.log('=== 测试完成 ===');

  } catch (error) {
    console.error('测试过程中出现错误:');
    console.error(error);
  } finally {
    await browser.close();
  }
})();
