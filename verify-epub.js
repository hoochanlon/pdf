const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('[console.error]', msg.text());
  });
  page.on('pageerror', err => console.log('[pageerror]', err.message));

  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });

  // 等待书单加载
  await page.waitForSelector('#book-list .book-item', { timeout: 15000 });
  const items = await page.$$eval('#book-list .book-item', els => els.map(e => e.textContent.trim()));
  console.log('book-list items:', items.length);
  console.log(items.join(' | '));

  // 找 EPUB 并打开
  const epubItem = await page.$$('#book-list .book-item');
  for (const el of epubItem) {
    const txt = await el.textContent();
    if (txt.includes('她身之欲') || txt.includes('EPUB')) {
      console.log('Clicking EPUB:', txt.trim());
      await el.click();
      break;
    }
  }

  // 等待 EPUB 加载
  try {
    await page.waitForFunction(() => {
      const c = document.getElementById('epub-container');
      return c && c.querySelector('iframe') && c.querySelector('iframe').contentDocument;
    }, { timeout: 20000 });
    console.log('EPUB iframe loaded: YES');
  } catch (e) {
    console.log('EPUB iframe loaded: NO -', e.message);
  }

  await page.waitForTimeout(2000);
  const state1 = await page.evaluate(() => ({
    renderMode: window.__state?.renderMode, epubMode: window.__state?.epubMode,
  }));
  console.log('state:', JSON.stringify(state1));

  // 尝试直接调用 epubNext - 检查全局
  const hasNext = await page.evaluate(() => typeof window.epubNext !== 'undefined');
  console.log('window.epubNext global:', hasNext);

  const frame = await page.evaluate(() => {
    const c = document.getElementById('epub-container');
    const ifr = c.querySelector('iframe');
    return ifr ? { src: ifr.src ? ifr.src.slice(0, 80) : 'no-src', docBody: !!ifr.contentDocument?.body } : null;
  });
  console.log('epub iframe info:', JSON.stringify(frame));

  // 尝试截图 iframe 内容
  try {
    const shot = await page.evaluate(() => {
      const c = document.getElementById('epub-container');
      const ifr = c.querySelector('iframe');
      if (!ifr) return 'no iframe';
      // 检查 iframe 是否同源可访问
      try {
        ifr.contentDocument.body.getBoundingClientRect();
        return 'same-origin: accessible';
      } catch (e) {
        return 'cross-origin: NOT accessible - ' + e.message;
      }
    });
    console.log('iframe access:', shot);
  } catch (e) {
    console.log('iframe access error:', e.message);
  }

  await browser.close();
  console.log('DONE');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
