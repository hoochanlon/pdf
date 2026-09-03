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
  await page.waitForTimeout(10000);

  const diag = await page.evaluate(() => {
    const c = document.getElementById('epub-container');
    const out = { containerHTML: c.innerHTML.slice(0, 1500) };
    const ifr = c.querySelector('iframe');
    if (ifr && ifr.contentDocument) {
      const d = ifr.contentDocument;
      out.docHTML = d.documentElement.outerHTML.slice(0, 1500);
    }
    return out;
  });
  console.log(JSON.stringify(diag, null, 2));
  await browser.close();
  console.log('DONE');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
