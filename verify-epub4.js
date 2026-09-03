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
  // 等待状态 ready
  await page.waitForFunction(() => {
    const s = document.getElementById('epub-status');
    return s && /ready|准备就绪|完成/.test(s.textContent || '');
  }, { timeout: 30000 }).catch(() => console.log('status text not ready-match'));
  await page.waitForTimeout(2000);

  const diag = await page.evaluate(() => {
    const c = document.getElementById('epub-container');
    const ifr = c.querySelector('iframe');
    if (!ifr) return { error: 'no iframe' };
    const d = ifr.contentDocument;
    const docEl = d.documentElement;
    return {
      viewportW: c.clientWidth,
      viewportH: c.clientHeight,
      docScrollWidth: docEl.scrollWidth,
      docClientWidth: docEl.clientWidth,
      htmlWidth: getComputedStyle(docEl).width,
      htmlStyleWidth: docEl.style.width,
      columnWidth: getComputedStyle(docEl).columnWidth,
      columnGap: getComputedStyle(docEl).columnGap,
      scrollX: ifr.contentWindow.scrollX,
      textLen: d.body ? d.body.textContent.length : -1,
      status: document.getElementById('epub-status')?.textContent,
    };
  });
  console.log('EPUB pagination diag:', JSON.stringify(diag, null, 2));

  await browser.close();
  console.log('DONE');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
