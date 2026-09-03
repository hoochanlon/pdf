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
  // poll until text content is substantial
  await page.waitForFunction(() => {
    const c = document.getElementById('epub-container');
    const ifr = c && c.querySelector('iframe');
    if (!ifr || !ifr.contentDocument) return false;
    return (ifr.contentDocument.body?.textContent?.length || 0) > 300;
  }, { timeout: 30000 }).catch(e => console.log('text-poll timeout'));
  await page.waitForTimeout(1500);

  const diag = await page.evaluate(() => {
    const c = document.getElementById('epub-container');
    const ifr = c.querySelector('iframe');
    const d = ifr.contentDocument;
    const docEl = d.documentElement;
    return {
      viewportW: c.clientWidth,
      docScrollWidth: docEl.scrollWidth,
      docClientWidth: docEl.clientWidth,
      columnWidth: getComputedStyle(docEl).columnWidth,
      textLen: d.body?.textContent?.length,
      bodyChildren: d.body?.children?.length,
    };
  });
  console.log('EPUB pagination diag:', JSON.stringify(diag, null, 2));

  // Now test: inject html-to-image and screenshot the iframe
  await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js' });
  await page.waitForFunction(() => typeof window.htmlToImage !== 'undefined', { timeout: 15000 });
  const shot = await page.evaluate(async () => {
    const c = document.getElementById('epub-container');
    const ifr = c.querySelector('iframe');
    const d = ifr.contentDocument;
    try {
      const dataUrl = await window.htmlToImage.toPng(d.documentElement, { width: c.clientWidth, height: c.clientHeight, pixelRatio: 1, style: { transform: 'none' } });
      return { ok: true, len: dataUrl.length, prefix: dataUrl.slice(0, 22) };
    } catch (e) {
      return { ok: false, err: e.message, stack: String(e.stack).slice(0, 200) };
    }
  });
  console.log('html-to-image result:', JSON.stringify(shot, null, 2));

  await browser.close();
  console.log('DONE');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
