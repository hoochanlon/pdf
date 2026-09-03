const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#book-list .book-item', { timeout: 15000 });
  const items = await page.$$('#book-list .book-item');
  for (const el of items) {
    const txt = await el.textContent();
    if (txt.includes('她身之欲')) { await el.click(); break; }
  }
  await page.waitForFunction(() => {
    const c = document.getElementById('epub-container');
    return c && c.querySelector('iframe') && c.querySelector('iframe').contentDocument?.body?.innerHTML?.length > 500;
  }, { timeout: 20000 });
  await page.waitForTimeout(1500);

  // 检查 epubjs 内部对象和分页机制
  const diag = await page.evaluate(() => {
    const c = document.getElementById('epub-container');
    const ifr = c.querySelector('iframe');
    const d = ifr.contentDocument;
    const docEl = d.documentElement;
    // 如果 columns，scrollWidth 会远超视口
    return {
      viewportW: c.clientWidth,
      docScrollWidth: docEl.scrollWidth,
      docClientWidth: docEl.clientWidth,
      totalText: d.body.textContent.length,
      htmlWidth: docEl.style.width || getComputedStyle(docEl).width,
      columnWidth: getComputedStyle(docEl).columnWidth,
      columnGap: getComputedStyle(docEl).columnGap,
      scrollX: ifr.contentWindow.scrollX,
    };
  });
  console.log('EPUB pagination diag:', JSON.stringify(diag, null, 2));

  await browser.close();
  console.log('DONE');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
