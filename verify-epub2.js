const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', err => console.log('[pageerror]', err.message));

  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#book-list .book-item', { timeout: 15000 });
  const items = await page.$$('#book-list .book-item');
  for (const el of items) {
    const txt = await el.textContent();
    if (txt.includes('她身之欲')) { await el.click(); break; }
  }

  await page.waitForFunction(() => {
    const c = document.getElementById('epub-container');
    return c && c.querySelector('iframe') && c.querySelector('iframe').contentDocument?.body?.children?.length;
  }, { timeout: 20000 });
  await page.waitForTimeout(1500);

  const info = await page.evaluate(() => {
    const c = document.getElementById('epub-container');
    const ifr = c.querySelector('iframe');
    const d = ifr.contentDocument;
    const docEl = d.documentElement;
    const w = getComputedStyle(docEl).width;
    const docWidth = docEl.scrollWidth;
    const bodyText = d.body ? d.body.textContent.slice(0, 30) : '';
    return {
      iframeCount: c.querySelectorAll('iframe').length,
      wrapperHtml: c.innerHTML.slice(0, 200),
      docWidth, w,
      bodyText,
      text: bodyText,
      docOffsetWidth: docEl.offsetWidth,
    };
  });
  console.log('EPUB structure:', JSON.stringify(info, null, 2));

  // 检查 keydown 能否在 iframe 里触发翻页
  const nav = await page.evaluate(async () => {
    const c = document.getElementById('epub-container');
    const ifr = c.querySelector('iframe');
    const win = ifr.contentWindow;
    const before = c.querySelector('iframe').contentDocument.body ? ifr.contentDocument.body.textContent.slice(0, 20) : '';
    return { before };
  });
  console.log('before nav:', nav.before);

  await browser.close();
  console.log('DONE');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
