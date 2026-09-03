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

  // Inject html-to-image
  await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js' });
  await page.waitForFunction(() => typeof window.htmlToImage !== 'undefined', { timeout: 15000 });

  // navigate to a text page a few times so there's multi-column content
  for (let i = 0; i < 12; i++) {
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })));
    await page.waitForTimeout(350);
  }
  await page.waitForTimeout(800);

  const result = await page.evaluate(async () => {
    const c = document.getElementById('epub-container');
    const ifr = c.querySelector('iframe');
    const d = ifr.contentDocument;
    const docEl = d.documentElement;
    const win = ifr.contentWindow;
    const vw = c.clientWidth, vh = c.clientHeight;
    const scrollLeft = win.scrollX || docEl.scrollLeft;
    const info = {
      vw, vh, scrollLeft, docScrollWidth: docEl.scrollWidth,
      textLen: d.body.textContent.length,
    };
    // capture visible region by translating
    try {
      const dataUrl = await window.htmlToImage.toPng(docEl, {
        width: vw,
        height: vh,
        pixelRatio: 1,
        style: { transform: `translateX(${-scrollLeft}px)` },
      });
      info.captured = { ok: true, len: dataUrl.length };
    } catch (e) {
      info.captured = { ok: false, err: e.message, stack: String(e.stack).slice(0, 300) };
    }
    return info;
  });
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  console.log('DONE');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
