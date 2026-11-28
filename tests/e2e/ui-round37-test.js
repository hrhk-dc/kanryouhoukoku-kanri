// Round 37：店データを OpenStreetMap に移した（評価・口コミ・価格帯は無い）。点数・内訳・理由・並び替えを、取れている情報だけで作る（390px・変更箇所だけ）
// 店データは OSM の形（name・lat/lng・address・industry・hours・phone/website/insta のある分だけ）。Firebase は偽物、API（ml-geocode・ml-search）は差し替える
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

const ALL_DAYS = { mon: '11:00〜21:00', tue: '11:00〜21:00', wed: '11:00〜21:00', thu: '11:00〜21:00', fri: '11:00〜21:00', sat: '11:00〜21:00', sun: '11:00〜21:00' };
// OSM の形：全部そろった店／営業時間も連絡先も無い店／業種が無く、SNS だけある店
const OSM_SHOPS = [
  { id: 'osm-full', name: 'テスト食堂A', industry: '食堂', address: '東京都テスト区1-1', lat: 35.6601, lng: 139.7001, hours: ALL_DAYS, phone: '03-0000-0001', website: '', visited: false },
  { id: 'osm-bare', name: 'テスト喫茶B', industry: '喫茶', address: '東京都テスト区2-2', lat: 35.6605, lng: 139.7010, hours: {}, visited: false },
  { id: 'osm-part', name: 'テスト店C', industry: '', address: '東京都テスト区3-3', lat: 35.6610, lng: 139.7020, hours: { mon: '10:00〜18:00' }, insta: 'testc', visited: false },
];

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_FAILED')) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  let searchBody = null;
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('https://www.gstatic.com/')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
    if (u.endsWith('/api/ml-geocode')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, lat: 35.66, lng: 139.7, label: 'テスト区', viewport: null }) });
    if (u.endsWith('/api/ml-search')) {
      searchBody = route.request().postData();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, shops: OSM_SHOPS, hasMore: false }) });
    }
    if (/\/api\/(demo-url|demo-queue|maps-info)$/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, urls: {}, demos: [] }) });
    if (u.startsWith(BASE)) return route.fallback();
    return route.abort();
  });
  try {
    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await wait(page, 900);
    await page.click('.app-seg[data-app="ml"]'); await wait(page, 900);
    await page.evaluate(() => {
      const i = document.getElementById('mlHost').shadowRoot.querySelector('#addr');
      i.value = 'テスト区'; i.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.evaluate(() => document.getElementById('mlHost').shadowRoot.querySelector('[data-act="run-search"]').click());
    await wait(page, 1000);

    // 1) 並び替えは「おすすめ順」「近い順」の2つ。評価順はない
    const sorts = await page.evaluate(() => [...document.querySelectorAll('#mlSortBar [data-ml-sort]')].map((b) => b.dataset.mlSort));
    ok('並び替えは おすすめ順・近い順・ルート順（評価順はない）', sorts.join('/') === 'rec/dist/route', sorts.join('/'));

    // 2) 提案：営業中のフィルタは、営業時間が無い店を落とさない（「不明」として残す）
    const cardsOn = await page.evaluate(() => {
      const sr = document.getElementById('mlHost').shadowRoot;
      return [...sr.querySelectorAll('#pList .shop')].map((c) => c.querySelector('.shop-name').textContent.trim());
    });
    ok('営業中のみでも、営業時間が無い店（テスト喫茶B）は落ちない', cardsOn.includes('テスト喫茶B'), cardsOn.join(','));

    // 業種・営業中を外して、3店すべてを見る
    await page.evaluate(() => { const o = document.getElementById('mlHost').shadowRoot.querySelector('[data-act="open-only"]'); if (o) o.click(); });
    await wait(page, 400);
    const cards = await page.evaluate(() => {
      const sr = document.getElementById('mlHost').shadowRoot;
      return [...sr.querySelectorAll('#pList .shop')].map((c) => ({
        name: c.querySelector('.shop-name').textContent.trim(),
        overall: c.querySelector('.overall b')?.textContent.trim(),
        items: [...c.querySelectorAll('.scores .score span')].map((s) => s.textContent.trim()),
        reasons: [...c.querySelectorAll('.reasons li')].map((l) => l.textContent.trim()),
        text: c.textContent,
      }));
    });
    ok('提案：3店すべて出る（評価・口コミ・価格帯のデータが無くても壊れない）', cards.length === 3, cards.map((c) => c.name).join(','));
    const byName = Object.fromEntries(cards.map((c) => [c.name, c]));
    ok('点数：全部そろった店は 10.0', byName['テスト食堂A']?.overall === '10.0', byName['テスト食堂A']?.overall);
    ok('点数：営業時間も連絡先も無い店は 6.0（ない項目は1点）', byName['テスト喫茶B']?.overall === '6.0', byName['テスト喫茶B']?.overall);
    ok('点数：一部だけそろった店は 8.0', byName['テスト店C']?.overall === '8.0', byName['テスト店C']?.overall);
    ok('並び：おすすめ順で、点数の高い順（10.0・8.0・6.0）', cards.map((c) => c.overall).join('/') === '10.0/8.0/6.0', cards.map((c) => c.overall).join('/'));
    ok('点数の内訳は4つ：営業時間・住所・業種・連絡先', cards.every((c) => c.items.join('/') === '営業時間/住所/業種/連絡先'), cards[0]?.items.join('/'));
    const bad = cards.filter((c) => /評価|口コミ|価格帯|チェーン|サイトなし/.test(c.text));
    ok('店カードに、評価・口コミ・価格帯・Google前提の表記がない', bad.length === 0, bad.map((c) => c.name).join(','));
    ok('理由：営業時間が無い店には「営業時間が分かって」と書かない', !byName['テスト喫茶B']?.reasons.some((r) => r.includes('営業時間が分かって')), JSON.stringify(byName['テスト喫茶B']?.reasons));
    ok('理由：評価や口コミに触れない', cards.every((c) => c.reasons.every((r) => !/評価|口コミ|価格|無い/.test(r))), JSON.stringify(cards.map((c) => c.reasons)));
    ok('理由：取れている情報から書く（全部そろった店は、住所・業種・連絡先の理由が出る）', byName['テスト食堂A']?.reasons.some((r) => r.includes('住所')) && byName['テスト食堂A']?.reasons.some((r) => r.includes('電話番号')), JSON.stringify(byName['テスト食堂A']?.reasons));

    // 3) 点数の内訳を開く：根拠は取れている中身だけ
    await page.evaluate(() => {
      const sr = document.getElementById('mlHost').shadowRoot;
      const card = [...sr.querySelectorAll('#pList .shop')].find((c) => c.querySelector('.shop-name').textContent.includes('テスト喫茶B'));
      card.querySelector('.score[data-k="hours"]').click();
    });
    await wait(page, 300);
    const detail = await page.evaluate(() => {
      const sr = document.getElementById('mlHost').shadowRoot;
      const d = sr.querySelector('.detail');
      return d ? d.textContent : '';
    });
    ok('内訳（営業時間）を開くと、根拠は「営業時間のデータはありません」', detail.includes('営業時間のデータはありません') && detail.includes('1点'), detail.slice(0, 120));
    ok('内訳に、評価・口コミ・価格帯の項目はない', !/評価|口コミ|価格帯/.test(detail), '');

    // 4) 並び替え「近い順」も動く
    await page.evaluate(() => document.querySelector('#mlSortBar [data-ml-sort="dist"]').click());
    await wait(page, 400);
    const distOrder = await page.evaluate(() => [...document.getElementById('mlHost').shadowRoot.querySelectorAll('#pList .shop .shop-name')].map((n) => n.textContent.trim()));
    ok('近い順に並ぶ（壊れない）', distOrder.length === 3, distOrder.join(','));

    // 5) 古い保存の並び「評価順」が残っていても壊れない（おすすめ順に戻る）
    const oldCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    const oldPage = await oldCtx.newPage();
    const oldErrors = [];
    oldPage.on('pageerror', (e) => oldErrors.push('pageerror: ' + e.message));
    oldPage.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_FAILED')) oldErrors.push(m.text()); });
    await oldPage.route('**/*', (route) => {
      const u = route.request().url();
      if (u.startsWith('https://www.gstatic.com/')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
      if (/\/api\/(demo-url|demo-queue|maps-info)$/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, urls: {}, demos: [] }) });
      if (u.startsWith(BASE)) return route.fallback();
      return route.abort();
    });
    await oldPage.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    await oldPage.evaluate(({ t, shops }) => {
      localStorage.setItem('vla:ui', JSON.stringify({
        day: t, poolDay: t, poolKey: '{"mode":"address"}', at: Date.now(),
        area: { mode: 'address', address: 'テスト区', lat: null, lng: null }, radius: '1km', count: 5, date: t,
        pSort: 'rating', pView: 'list', openOnly: true, expanded: [], listSort: 'default', pIndOpen: false, screen: 'proposal',
        snap: { area: 'テスト区', radius: '1km', industry: '全て' },
        pool: shops.map((s) => ({ ...s, distance: 10, sub: { hours: 5, address: 5, industry: 5, contact: 5 }, total5: 5, overall: 10, reasons: ['住所がはっきりしていて、場所を確かめやすいお店です'] })),
      }));
    }, { t: today, shops: OSM_SHOPS });
    await oldPage.reload({ waitUntil: 'domcontentloaded' });
    await wait(oldPage, 1200);
    await oldPage.click('.app-seg[data-app="ml"]'); await wait(oldPage, 1000);
    const oldSort = await oldPage.evaluate(() => ({
      sorts: [...document.querySelectorAll('#mlSortBar [data-ml-sort]')].map((b) => b.dataset.mlSort).join('/'),
      shown: document.getElementById('mlHost').shadowRoot.querySelectorAll('#pList .shop').length,
    }));
    ok('古い保存の並び「評価順」が残っていても、画面は壊れない（提案が出る）', oldSort.shown >= 1 && oldErrors.length === 0, JSON.stringify({ ...oldSort, errors: oldErrors }));
    await oldCtx.close();

    // 6) 390px：横にはみ出さない
    ok('390px：横スクロールなし', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
    await page.evaluate(() => document.getElementById('mlHost').shadowRoot.querySelector('#pList .shop').scrollIntoView({ block: 'start' }));
    await wait(page, 200);
    await page.screenshot({ path: `${SHOTS}/r37-osm.png` });

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
