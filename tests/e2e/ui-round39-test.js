// Round 39：マップリストの追加の修正（390px・変更箇所だけ）
// 並び順の初めの値（地図＝ルート順、一覧＝おすすめ順）、ピンの番号（1・2…10・11…）が枠に収まるか、
// 「営業している店のみ」の切り替えの見た目、サイトのある店・チェーン店が画面に出ないこと。Firebase は偽物、API は差し替える
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SHOTS = process.env.SHOTS || '/tmp';
const BASE = process.argv[2] || 'http://localhost:8767';

const src = fs.readFileSync(path.join(__dirname, 'integration-test.js'), 'utf8');
const STUB = src.match(/const STUB = `([\s\S]*?)`;/)[1];

const results = [];
const ok = (name, cond, extra = '') => results.push({ name, pass: !!cond, extra: String(extra) });
const wait = (page, ms) => page.waitForTimeout(ms);

const ALL = { mon: '11:00〜21:00', tue: '11:00〜21:00', wed: '11:00〜21:00', thu: '11:00〜21:00', fri: '11:00〜21:00', sat: '11:00〜21:00', sun: '11:00〜21:00' };
const shop = (i, extra = {}) => {
  const ang = (i * 137) % 360, r = 0.0015 + ((i * 53) % 10) * 0.0009;
  return {
    id: `s-${i}`, name: `テスト店${i + 1}`, industry: i % 2 ? '喫茶' : '食堂', address: `東京都テスト区${i + 1}-1`,
    lat: 35.66 + r * Math.sin(ang * Math.PI / 180), lng: 139.70 + r * Math.cos(ang * Math.PI / 180),
    hours: ALL, phone: '03-0000-0000', website: '', insta: '', visited: false, ...extra,
  };
};
// 12件（2けたのピンを確かめるため）
const TWELVE = Array.from({ length: 12 }, (_, i) => shop(i));
// サイトのある店・チェーン店（brand の印）は、サーバーが返しても画面に出さない（二重の確認）
const MIXED = [shop(0), shop(1, { website: 'https://example.com/x', name: 'サイトあり店' }), shop(2, { brand: 'テストチェーン', name: 'テストチェーン 駅前店' }), shop(3, { name: '独立した店' })];

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const errors = [];
  let searchShops = TWELVE;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_FAILED')) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('https://www.gstatic.com/')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
    if (u.endsWith('/api/ml-geocode')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, lat: 35.66, lng: 139.70, label: 'テスト区', viewport: null }) });
    if (u.endsWith('/api/ml-search')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, shops: searchShops, hasMore: false }) });
    if (/\/api\/(demo-url|demo-queue|maps-info)$/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, urls: {}, demos: [] }) });
    if (u.startsWith(BASE)) return route.fallback();
    return route.abort();
  });
  const sr = (fn, arg) => page.evaluate(fn, arg);
  const runSearch = async (addr = 'テスト区') => {
    await sr((a) => { const i = document.getElementById('mlHost').shadowRoot.querySelector('#addr'); i.value = a; i.dispatchEvent(new Event('input', { bubbles: true })); }, addr);
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('[data-act="run-search"]').click());
    await wait(page, 1000);
  };
  try {
    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await wait(page, 900);
    await page.click('.app-seg[data-app="ml"]'); await wait(page, 900);
    await runSearch();

    // 1) 並び順の初めの値：一覧＝おすすめ順、地図＝ルート順
    const activeSort = () => page.evaluate(() => document.querySelector('#mlSortBar [data-ml-sort].on')?.dataset.mlSort || '');
    const listSort = await activeSort();
    await page.evaluate(() => document.getElementById('mlHost').shadowRoot.querySelector('#pView [data-v="map"]').click());
    await wait(page, 900);
    const mapSort = await activeSort();
    await page.evaluate(() => document.getElementById('mlHost').shadowRoot.querySelector('#pView [data-v="list"]').click());
    await wait(page, 600);
    const backSort = await activeSort();
    ok('一覧で見るのとき、並び順の初めはおすすめ順', listSort === 'rec', listSort);
    ok('地図で見るを押すと、並び順はルート順に変わる', mapSort === 'route', mapSort);
    ok('一覧で見るに戻すと、並び順はおすすめ順に戻る', backSort === 'rec', backSort);

    // 2) ピンの番号：1〜12。10・11・12 は数字で続き、2けたは枠に収まる
    await page.evaluate(() => document.getElementById('mlHost').shadowRoot.querySelector('#pView [data-v="map"]').click());
    await wait(page, 1200);
    const pins = await sr(() => {
      const s = document.getElementById('mlHost').shadowRoot;
      const li = [...s.querySelectorAll('.map-order .pin-no')].map((x) => x.textContent.trim());
      const lp = [...s.querySelectorAll('.map-box .lp-pin')].map((el) => {
        const r = document.createRange(); r.selectNodeContents(el);
        const t = r.getBoundingClientRect(), b = el.getBoundingClientRect();
        return { text: el.textContent.trim(), fits: t.width <= b.width - 2 && t.height <= b.height, fs: getComputedStyle(el).fontSize };
      });
      return { li, lp };
    });
    ok('番号は 1, 2, … 9, 10, 11, 12 と数字で続く（A などの文字は出ない）', pins.li.join(',') === '1,2,3,4,5,6,7,8,9,10,11,12', pins.li.join(','));
    ok('地図のピンの番号も 1〜12 の数字', pins.lp.map((p) => p.text).join(',') === '1,2,3,4,5,6,7,8,9,10,11,12', pins.lp.map((p) => p.text).join(','));
    const twoDigit = pins.lp.filter((p) => p.text.length === 2);
    ok('2けたのピン（10〜12）は、文字が枠の中に収まる', twoDigit.length === 3 && twoDigit.every((p) => p.fits), JSON.stringify(twoDigit));
    ok('2けたのピンは文字を小さくする（11px）', twoDigit.every((p) => p.fs === '11px'), twoDigit.map((p) => p.fs).join(','));
    await page.evaluate(() => document.getElementById('mlHost').shadowRoot.querySelector('.map-box').scrollIntoView({ block: 'center' }));
    await wait(page, 200);
    await page.screenshot({ path: `${SHOTS}/r39-pins.png` });

    // 3) 「営業している店のみ」のスイッチ：オフ＝純黒の溝、オン＝純黒の中＋虹色の縁（半透明の混色はしない）
    await page.evaluate(() => document.getElementById('mlHost').shadowRoot.querySelector('#pView [data-v="list"]').click());
    await wait(page, 600);
    const sw = await sr(() => {
      const b = document.getElementById('mlHost').shadowRoot.querySelector('#pOpen');
      const c = getComputedStyle(b);
      return { on: b.getAttribute('aria-checked'), bg: c.backgroundImage, bgc: c.backgroundColor };
    });
    await page.evaluate(() => document.getElementById('mlHost').shadowRoot.querySelector('#pOpen').click());
    await wait(page, 400);
    const sw2 = await sr(() => { const b = document.getElementById('mlHost').shadowRoot.querySelector('#pOpen'); const c = getComputedStyle(b); return { on: b.getAttribute('aria-checked'), bg: c.backgroundImage, bgc: c.backgroundColor }; });
    ok('スイッチのオン・オフが切り替わる', sw.on !== sw2.on, `${sw.on}→${sw2.on}`);
    const onState = sw.on === 'true' ? sw : sw2, offState = sw.on === 'true' ? sw2 : sw;
    ok('スイッチのオンは、虹色の細い縁（グラデーション）', onState.bg.includes('linear-gradient') && onState.bg.includes('rgb(63, 240, 255)'), onState.bg.slice(0, 120));
    ok('スイッチのオフは、グラデーションを使わない（純黒の溝）', !offState.bg.includes('rgb(63, 240, 255)') && offState.bgc === 'rgb(11, 13, 18)', `${offState.bgc}`);
    await page.evaluate(() => { const b = document.getElementById('mlHost').shadowRoot.querySelector('#pOpen'); b.scrollIntoView({ block: 'center' }); });
    await wait(page, 200);
    await page.screenshot({ path: `${SHOTS}/r39-switch-on.png` });
    await page.evaluate(() => document.getElementById('mlHost').shadowRoot.querySelector('#pOpen').click());
    await wait(page, 400);
    await page.screenshot({ path: `${SHOTS}/r39-switch-off.png` });
    await page.evaluate(() => document.getElementById('mlHost').shadowRoot.querySelector('#pOpen').click());
    await wait(page, 300);

    // 4) サイトのある店・チェーン店は、画面に出ない（サーバーが返しても、画面でも外す）
    searchShops = MIXED;
    // 条件を変えて、保存した候補を使わずに取り直す（住所の文字を変える）
    await page.evaluate(() => document.querySelector('#mainNav [data-ml-nav="search"]').click());
    await wait(page, 500);
    await runSearch('テスト区 別');
    const names = await sr(() => [...document.getElementById('mlHost').shadowRoot.querySelectorAll('#pList .shop .shop-name')].map((n) => n.textContent.trim()));
    ok('サイトのある店・チェーン店は、候補に出ない（独立した店だけ残る）', names.length === 2 && names.includes('テスト店1') && names.includes('独立した店'), names.join(','));
    ok('サイトありの店の名前が出ない', !names.some((n) => n.includes('サイトあり')), names.join(','));
    ok('チェーンの店の名前が出ない', !names.some((n) => n.includes('チェーン')), names.join(','));

    // 5) 画面全体を見る（レビュー用）
    searchShops = TWELVE;
    await runSearch();
    await page.evaluate(() => document.getElementById('mlHost').shadowRoot.querySelector('#pView [data-v="list"]').click());
    await wait(page, 500);
    await page.evaluate(() => document.getElementById('mlHost').shadowRoot.querySelector('#pList .shop').scrollIntoView({ block: 'start' }));
    await wait(page, 200);
    await page.screenshot({ path: `${SHOTS}/r39-list.png` });

    ok('390px：横スクロールなし', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
    ok('コンソールエラーなし', errors.length === 0, errors.join(' | '));
  } catch (e) {
    ok('テストが最後まで走った', false, e.message.split('\n')[0]);
  } finally {
    await browser.close();
  }
  let fail = 0;
  for (const r of results) { if (!r.pass) fail++; console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.extra ? '  [' + r.extra + ']' : ''}`); }
  console.log(`\n${results.length - fail}/${results.length} passed`);
  process.exitCode = fail ? 1 : 0;
})();
