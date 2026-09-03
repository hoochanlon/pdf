const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  page.on('console', m => { if (m.type()==='error' && !m.text().includes('Failed to load resource')) console.log('[console.error]', m.text()); });
  await page.goto('http://localhost:3000/crop-test.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  console.log(await page.textContent('#out'));
  await browser.close();
  console.log('DONE');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
