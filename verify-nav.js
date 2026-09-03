const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#book-list .book-item', { timeout: 15000 });
  const items = await page.$$('#book-list .book-item');
  for (const el of items) {
    const txt = await el.textContent();
    if (txt.includes('性经验史')) { await el.click(); break; }
  }
  await page.waitForTimeout(8000);

  await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js' });
  await page.waitForFunction(() => typeof window.htmlToImage !== 'undefined', { timeout: 15000 });

  // Navigate via state.rendition - but state may not be on window. Try to access via evaluating module
  // Since ESM, state isn't global. Instead press arrows inside the iframe? epubjs binds keys on rendition.
  // Let's dispatch keydown on document (epubjs sets keydown on rendition's container iframe window)
  const info = await page.evaluate(async () => {
    const c = document.getElementById('epub-container');
    const ifr = c.querySelector('iframe');
    const win = ifr.contentWindow;
    const results = [];
    for (let i = 0; i < 15; i++) {
      win.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await new Promise(r => setTimeout(r, 300));
      const d = ifr.contentDocument;
      const docEl = d.documentElement;
      results.push({
        i, scrollX: win.scrollX, docScrollWidth: docEl.scrollWidth,
        text: d.body.textContent.slice(0, 12).replace(/\n/g, ''),
      });
    }
    return results;
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
  console.log('DONE');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
