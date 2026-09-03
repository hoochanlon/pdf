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
  await page.waitForTimeout(6000);

  const info = await page.evaluate(async () => {
    const c = document.getElementById('epub-container');
    const ifr = c.querySelector('iframe');
    const win = ifr.contentWindow;
    const doc = ifr.contentDocument;
    const results = [];
    for (let i = 0; i < 20; i++) {
      doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await new Promise(r => setTimeout(r, 400));
      const docEl = doc.documentElement;
      results.push({
        i, scrollX: win.scrollX, docScrollWidth: docEl.scrollWidth,
        text: doc.body.textContent.slice(0, 15).replace(/\s+/g, ' ').trim(),
        iframeSrc: (ifr.getAttribute('srcdoc')||'').slice(0, 0) + ifr.id,
        children: doc.body.children.length,
      });
    }
    return results;
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
  console.log('DONE');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
