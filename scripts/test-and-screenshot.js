// E2E test + screenshots. Usage: BASE=http://localhost:4826 node scripts/test-and-screenshot.js
const { chromium } = require('playwright-core');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:4826';
const OUT = process.env.OUT || path.join(__dirname, '../../screenshots');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  // ---- functional test (desktop)
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('#r-name', 'Test Guest'); await page.fill('#r-email', 'test.guest@example.com');
  await page.click('text=Joyfully accepts');
  await page.selectOption('#r-party', '2'); await page.fill('#r-diet', 'No pork');
  await page.fill('#r-song', 'Water Tyla');
  await page.waitForSelector('#song-results li[data-i]', { timeout: 10000 });
  const n = await page.locator('#song-results li[data-i]').count();
  assert(n > 0, `song search returned ${n} results`);
  await page.locator('.song-field').screenshot({ path: OUT + '/desktop-song-search-dropdown.png' }).catch(()=>{});
  await page.locator('#rsvp .split-body').screenshot({ path: OUT + '/desktop-song-search-results.png' });
  const first = await page.locator('#song-results li[data-i]').first().innerText();
  await page.locator('#song-results li[data-i]').first().dispatchEvent('mousedown');
  assert(await page.isVisible('#song-picked'), 'song selected: ' + first.replace(/\n/g, ' / '));
  await page.click('#rsvp-form [type=submit]');
  await page.waitForSelector('#rsvp-msg.ok', { timeout: 5000 });
  assert(true, 'RSVP confirmation: ' + await page.innerText('#rsvp-msg'));
  // quiz
  await page.fill('#quiz-name', 'Auntie Test'); await page.click('#quiz-name-form button');
  const total = 10;
  for (let i = 0; i < total; i++) {
    await page.waitForSelector(`#q-count:has-text("Question ${i + 1} of")`);
    await page.locator('#q-options button').nth(i % 2).click();
    await page.waitForTimeout(260);
  }
  await page.waitForSelector('#quiz-result:not([hidden])');
  assert(true, 'quiz score: ' + await page.innerText('#quiz-score'));
  assert((await page.innerText('#leaderboard')).includes('Auntie Test'), 'quiz entry appears on leaderboard');

  // ---- screenshots
  for (const [label, vp] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor || 1, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch });
    const p = await ctx.newPage();
    await p.goto(BASE, { waitUntil: 'networkidle' });
    await p.evaluate(async () => { document.querySelectorAll('.reveal').forEach(e => e.classList.add('in')); document.querySelectorAll('img[loading=lazy]').forEach(i => i.loading = 'eager'); for (let y = 0; y < document.body.scrollHeight; y += 600) { scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); } scrollTo(0, 0); });
    await p.waitForLoadState('networkidle'); await p.waitForTimeout(1500);
    await p.screenshot({ path: `${OUT}/${label}-full-page.png`, fullPage: true });
    await p.screenshot({ path: `${OUT}/${label}-home.png` });
    await p.evaluate(() => { document.getElementById('nav').style.visibility = 'hidden'; });
    for (const s of ['rsvp', 'fund', 'quiz', 'story', 'details']) await p.locator('#' + s).screenshot({ path: `${OUT}/${label}-${s}.png` });
    await ctx.close();
  }
  console.log('screenshots saved to', OUT);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
