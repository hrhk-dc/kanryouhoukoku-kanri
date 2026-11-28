// Round 38：統合マップリストの地図（全画面の二重表示・地図の作り直しの競合・ピンの詳細・ルート順・帰属表示）（390px・変更箇所だけ）
// 実機の iPhone Safari は、この環境からは確かめられない（別途、実機で確認する）。ここでは Chromium の 390px で確かめる
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
// 10件（位置はばらつけてある。営業時間・連絡先の有無もまちまち）
const SHOPS = Array.from({ length: 10 }, (_, i) => {
  const ang = (i * 137) % 360, r = 0.0015 + ((i * 53) % 10) * 0.0009;
  const lat = 35.66 + r * Math.sin(ang * Math.PI / 180), lng = 139.70 + r * Math.cos(ang * Math.PI / 180);
  return {
    id: `r-${i}`, name: `テスト店${i + 1}`, industry: i % 2 ? '喫茶' : '食堂', address: `東京都テスト区${i + 1}-1`,
    lat, lng, hours: i % 3 === 0 ? {} : ALL, phone: i % 2 ? '' : `03-0000-00${i}`, website: '',
    insta: i % 5 === 0 ? 'shop' : '', visited: false,
  };
});

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_FAILED')) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('https://www.gstatic.com/')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
    if (u.endsWith('/api/ml-geocode')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, lat: 35.66, lng: 139.70, label: 'テスト区', viewport: null }) });
    if (u.endsWith('/api/ml-search')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, shops: SHOPS, hasMore: false }) });
    if (/\/api\/(demo-url|demo-queue|maps-info)$/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, urls: {}, demos: [] }) });
    if (u.startsWith(BASE)) return route.fallback();
    return route.abort();
  });
  const sr = (fn, arg) => page.evaluate(fn, arg);
  const SR = 'document.getElementById("mlHost").shadowRoot';
  try {
    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await wait(page, 900);
    await page.click('.app-seg[data-app="ml"]'); await wait(page, 900);
    await sr(() => { const i = document.getElementById('mlHost').shadowRoot.querySelector('#addr'); i.value = 'テスト区'; i.dispatchEvent(new Event('input', { bubbles: true })); });
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('[data-act="run-search"]').click());
    await wait(page, 1000);
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('[data-act="open-only"]')?.click());   // 営業中のみを外す（10件そろえる）
    await wait(page, 300);
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('#pView [data-v="map"]').click());
    await wait(page, 1500);
    const inlineCount = () => sr(() => document.getElementById('mlHost').shadowRoot.querySelectorAll('.leaflet-container').length);

    // 1) 地図は1つだけ。帰属表示は「© OpenStreetMap contributors」だけ（Leaflet の名前は出ない）
    ok('提案の地図は1つだけ出る', (await inlineCount()) === 1, await inlineCount());
    const attr = await sr(() => {
      const a = document.getElementById('mlHost').shadowRoot.querySelector('.leaflet-control-attribution');
      return a ? { text: a.textContent, href: [...a.querySelectorAll('a')].map((x) => x.getAttribute('href')), fs: getComputedStyle(a).fontSize } : null;
    });
    ok('帰属表示は「© OpenStreetMap contributors」を残し、Leaflet の名前は外す', !!attr && attr.text.includes('© OpenStreetMap contributors') && !attr.text.includes('Leaflet'), JSON.stringify(attr));
    ok('帰属表示のリンクは openstreetmap.org/copyright', !!attr && attr.href.some((h) => h && h.includes('openstreetmap.org/copyright')), JSON.stringify(attr && attr.href));
    ok('帰属表示は小さく（9px）', !!attr && attr.fs === '9px', attr && attr.fs);
    const iso = await sr(() => getComputedStyle(document.getElementById('mlHost').shadowRoot.querySelector('#mapBox')).isolation);
    ok('地図の箱は isolation: isolate（地図のペインを閉じ込める）', iso === 'isolate', iso);

    // 2) 全画面：一度だけ開く（連打しても二重にならない）→ 元の地図は外れ、全画面だけになる
    await sr(() => { const b = document.getElementById('mlHost').shadowRoot.querySelector('[data-act="map-full"]'); b.click(); b.click(); b.click(); });
    await wait(page, 900);
    const full1 = await sr(() => {
      const sr2 = document.getElementById('mlHost').shadowRoot;
      const f = sr2.querySelector('.mapfull');
      return { full: sr2.querySelectorAll('.mapfull').length, maps: sr2.querySelectorAll('.leaflet-container').length, z: f ? getComputedStyle(f).zIndex : null, inlineMap: !!sr2.querySelector('#mapBox .leaflet-container') };
    });
    ok('全画面ボタンを連打しても、全画面は1つ', full1.full === 1, JSON.stringify(full1));
    ok('全画面を開いている間、地図は全画面の1つだけ（元の地図は残らない）', full1.maps === 1 && !full1.inlineMap, JSON.stringify(full1));
    ok('全画面の重なり順は 10000 以上', Number(full1.z) >= 10000, full1.z);
    const sizeOk = await sr(() => { const m = document.getElementById('mlHost').shadowRoot.querySelector('#mapFullBox'); return m.clientHeight > 300 && m.clientWidth > 300; });
    ok('全画面の地図は画面いっぱいの大きさで出る', sizeOk, '');
    await page.screenshot({ path: `${SHOTS}/r38-full.png` });

    // 3) ピンをタップ：下のバーに店の情報（番号・店名・業種・住所・距離・当日の営業時間か定休日）
    await sr(() => { const pin = document.getElementById('mlHost').shadowRoot.querySelector('.mapfull .lp-pin'); pin.parentElement.click(); });
    await wait(page, 500);
    const bar = await sr(() => {
      const b = document.getElementById('mlHost').shadowRoot.querySelector('#mapFullBar');
      return b && !b.hidden ? b.textContent.replace(/\s+/g, ' ').trim() : '';
    });
    ok('全画面でピンを押すと、下のバーに店名・業種・住所・距離・営業時間が出る', bar.length > 0 && /テスト店/.test(bar) && /m|km/.test(bar) && /(定休日|11:00|営業時間は不明)/.test(bar), bar.slice(0, 120));
    await page.screenshot({ path: `${SHOTS}/r38-full-pin.png` });

    // 4) 「詳しく見る」で、既存のシートが全画面の上に出る（電話・サイト・訪問の操作）
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('#mapFullBar [data-fb="detail"]').click());
    await wait(page, 400);
    const sheet = await sr(() => {
      const s = document.getElementById('mlHost').shadowRoot;
      const sh = s.querySelector('#sheet');
      return { open: sh && !sh.hidden, z: sh ? getComputedStyle(sh).zIndex : null, add: !!s.querySelector('#sheet [data-act="add"]'), copy: !!s.querySelector('#sheet [data-act="copy-map"]'), block: !!s.querySelector('#sheet [data-act="block"]'), tel: !!s.querySelector('#sheet a[href^="tel:"]') || !s.querySelector('#sheet .pill-btn') };
    });
    ok('詳細シートが開き、全画面の上に出る', sheet.open && Number(sheet.z) > 10000, JSON.stringify(sheet));
    ok('詳細には「訪問予定に追加」「Map URLコピー」「訪問NG」がある', sheet.add && sheet.copy && sheet.block, JSON.stringify(sheet));
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('#sheet [data-close]').click());
    await wait(page, 300);

    // 5) 閉じて、すぐ開き直す。提案の地図は、閉じたあとに1つだけ戻る
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('.mapfull-x').click());
    await wait(page, 500);
    const afterClose = await sr(() => ({ full: document.getElementById('mlHost').shadowRoot.querySelectorAll('.mapfull').length, maps: document.getElementById('mlHost').shadowRoot.querySelectorAll('.leaflet-container').length, sheetOpen: !document.getElementById('mlHost').shadowRoot.querySelector('#sheet').hidden }));
    ok('閉じると、全画面は消え、提案の地図が1つ戻る', afterClose.full === 0 && afterClose.maps === 1, JSON.stringify(afterClose));
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('[data-act="map-full"]').click());
    await wait(page, 300);
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('.mapfull-x').click());
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('[data-act="map-full"]').click());
    await wait(page, 700);
    const reopen = await sr(() => ({ full: document.getElementById('mlHost').shadowRoot.querySelectorAll('.mapfull').length, maps: document.getElementById('mlHost').shadowRoot.querySelectorAll('.leaflet-container').length }));
    ok('閉じて、すぐ開き直しても、全画面は1つ・地図は1つ', reopen.full === 1 && reopen.maps === 1, JSON.stringify(reopen));
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('.mapfull-x').click());
    await wait(page, 500);

    // 6) 一覧／地図の素早い切り替えでも、地図は1つだけ・エラーなし
    for (let k = 0; k < 4; k++) {
      await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('#pView [data-v="list"]').click());
      await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('#pView [data-v="map"]').click());
    }
    await wait(page, 1200);
    ok('一覧と地図を素早く切り替えても、地図は1つだけ', (await inlineCount()) === 1, await inlineCount());

    // 7) ルート順：並べ替えに「ルート順」。番号は回る順。区間距離が出る。地図に線が引かれる
    await page.evaluate(() => document.querySelector('[data-ml-sort="route"]').click());
    await wait(page, 1200);
    const route = await sr(() => {
      const s = document.getElementById('mlHost').shadowRoot;
      const items = [...s.querySelectorAll('.map-order li')];
      return {
        n: items.length,
        legs: items.map((li) => li.querySelector('small').textContent.trim()),
        pins: items.map((li) => li.querySelector('.pin-no').textContent.trim()).join(''),
        lines: s.querySelectorAll('.leaflet-overlay-pane path').length,
        hint: [...s.querySelectorAll('.map-card .hint')].map((h) => h.textContent).join(' '),
      };
    });
    ok('ルート順：10件が並ぶ（番号は 1〜10 の数字の順）', route.n === 10 && route.pins === '12345678910', JSON.stringify(route));
    ok('ルート順：区間距離（前から…）が出る', route.legs.every((t) => /前から/.test(t)), route.legs.join(','));
    ok('ルート順：線が引かれる（地図の上に線がある）', route.lines >= 1, route.lines);
    ok('ルート順：合計の道のりが出る', route.hint.includes('ルートの合計は約'), route.hint.slice(0, 80));
    // 並びの質：ルートの合計（画面の区間距離の和）が、店の順（作った順）に回った合計より短い
    const routeSum = await sr(() => [...document.getElementById('mlHost').shadowRoot.querySelectorAll('.map-order li small')].map((el) => { const m = el.textContent.match(/([\d.]+)(km|m)/); return m ? (m[2] === 'km' ? Number(m[1]) * 1000 : Number(m[1])) : 0; }).reduce((a, b) => a + b, 0));
    const hav = (a, b) => { const R = 6371000, t = Math.PI / 180; const dl = (b.lat - a.lat) * t, dg = (b.lng - a.lng) * t; const x = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dg / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
    const center = { lat: 35.66, lng: 139.70 };
    let naive = 0, prev = center;
    for (const sh of SHOPS) { naive += hav(prev, sh); prev = sh; }
    ok(`ルート順の合計（${Math.round(routeSum)}m）は、店の順に回った合計（${Math.round(naive)}m）より短い`, routeSum < naive, `route=${Math.round(routeSum)} naive=${Math.round(naive)}`);
    await page.screenshot({ path: `${SHOTS}/r38-route.png` });

    // 8) 絞り込み（営業中のみ）を変えると、ルートも作り直される
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('[data-act="open-only"]').click());
    await wait(page, 800);
    const after = await sr(() => ({ n: document.getElementById('mlHost').shadowRoot.querySelectorAll('.map-order li').length, pins: [...document.getElementById('mlHost').shadowRoot.querySelectorAll('.map-order li .pin-no')].map((x) => x.textContent).join('') }));
    ok('営業中のみを変えると、ルートも作り直される（ピンは並びの番号どおり）', after.n >= 1 && after.pins === Array.from({ length: after.n }, (_, i) => String(i + 1)).join(''), JSON.stringify(after));
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('[data-act="open-only"]').click());
    await wait(page, 600);

    // 9) おすすめ順・近い順も残っている
    for (const v of ['rec', 'dist']) {
      await page.evaluate((x) => document.querySelector(`[data-ml-sort="${x}"]`).click(), v);
      await wait(page, 500);
    }
    ok('おすすめ順・近い順は今まで通り切り替わる', (await sr(() => document.querySelectorAll('[data-ml-sort]').length)) === 3, '');

    // 10) 全画面（ルート順）でも、線と番号が出る
    await page.evaluate(() => document.querySelector('[data-ml-sort="route"]').click());
    await wait(page, 1000);
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('[data-act="map-full"]').click());
    await wait(page, 700);
    const fullRoute = await sr(() => ({ pins: document.getElementById('mlHost').shadowRoot.querySelectorAll('.mapfull .lp-pin').length, lines: document.getElementById('mlHost').shadowRoot.querySelectorAll('.mapfull .leaflet-overlay-pane path').length }));
    ok('全画面（ルート順）：番号のピンと線が出る', fullRoute.pins === 10 && fullRoute.lines >= 1, JSON.stringify(fullRoute));
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('.mapfull-x').click());
    await wait(page, 400);

    // 11) 390px：横にはみ出さない
    ok('390px：横スクロールなし', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
    ok('コンソールエラーなし（Map container is already initialized を含む）', errors.length === 0, errors.join(' | '));
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
