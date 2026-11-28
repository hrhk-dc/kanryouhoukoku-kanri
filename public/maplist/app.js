(function () {
  'use strict';

  // ---------- 小さな道具 ----------
  // 完了報告アプリの中に、影の根（shadow root）として組み込まれている。この画面の中の要素・クリックだけを扱う
  const root = window.__mlRoot;
  const $ = (s, r = root) => r.querySelector(s);
  const $$ = (s, r = root) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const D = window.VLA_DATA;

  // ---------- 日付（すべて日本時間 JST 基準） ----------
  const JST_MS = 9 * 3600 * 1000;
  const pad = (n) => String(n).padStart(2, '0');
  const WD_JP = ['日', '月', '火', '水', '木', '金', '土'];
  const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // 月曜始まりで表示
  const ymdOf = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const todayJst = () => ymdOf(new Date(Date.now() + JST_MS));
  const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return ymdOf(new Date(Date.UTC(y, m - 1, d + n))); };
  const wdOf = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
  const weekKey = (s) => DAY_KEYS[wdOf(s)];
  const fmtDate = (s) => { const [, m, d] = s.split('-').map(Number); return `${m}月${d}日（${WD_JP[wdOf(s)]}）`; };

  // ---------- 定数 ----------
  const RADIUS = [
    ['1km', '1km', 1000],
    ['2km', '2km', 2000],
    ['3km', '3km', 3000],
    ['5km', '5km', 5000],
  ];
  // 保存されていた半径（今の選択肢に無いもの：4km・500m・町名まるごとなど）は、一番近い選択肢に丸める
  function radiusKey(v) {
    const km = /^(\d+(?:\.\d+)?)km$/.exec(String(v || ''));
    const m0 = /^(\d+)m$/.exec(String(v || ''));
    const m = km ? Number(km[1]) * 1000 : m0 ? Number(m0[1]) : 1000;
    return RADIUS.reduce((best, r) => (Math.abs(r[2] - m) < Math.abs(best[2] - m) ? r : best), RADIUS[0])[0];
  }
  // 業種の選び方（簡易）：全て・飲食店・飲食店以外。検索の分類になる（API の category）
  const CATS = [['all', '全て'], ['food', '飲食店'], ['other', '飲食店以外']];
  const catLabel = (k) => (CATS.find(([c]) => c === k) || CATS[0])[1];
  const MAX_PAGES = 3;    // 1分類あたり60件まで
  const REASONS_BLOCK = ['出禁', '廃業・閉店', 'ターゲット外'];
  const SCREENS = ['search', 'proposal', 'list', 'later'];
  const NAV = [['search', '検索', 'search'], ['proposal', '提案', 'target'], ['list', '訪問予定', 'list'], ['later', '後で訪問', 'later']];
  const SITE_URL = 'https://kanryohkk-app.pages.dev';

  // ---------- 線のアイコン（1.5px・塗りつぶしなし） ----------
  const ICON_PATHS = {
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
    later: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/>',
    map: '<path d="M9 4L3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4z"/><path d="M9 4v14M15 6v14"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
    cal: '<rect x="4" y="5.5" width="16" height="14.5" rx="3"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
    insta: '<rect x="4" y="4" width="16" height="16" rx="4.5"/><circle cx="12" cy="12" r="3.6"/><path d="M16.8 7.2h.01"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
    gps: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
    block: '<circle cx="12" cy="12" r="8.5"/><path d="M6 18L18 6"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
    next: '<path d="M9 6l6 6-6 6"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  };
  const ic = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;

  // ---------- 保存（端末内。訪問リストの本番保存は別途） ----------
  const LS = {
    get(k, def) { try { const v = localStorage.getItem('vla:' + k); return v ? JSON.parse(v) : def; } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem('vla:' + k, JSON.stringify(v)); } catch (e) { /* 保存できない端末では無視 */ } },
  };

  // ---------- おすすめの点数（情報の充実度ベース。店の情報は OpenStreetMap から。評価・口コミ・価格帯は使わない） ----------
  // 4つの項目（同じ重み25%）。ある＝5点、ない＝1点（ない項目を0点にはしない）
  const KEYS = ['hours', 'address', 'industry', 'contact'];
  const W = { hours: 0.25, address: 0.25, industry: 0.25, contact: 0.25 };
  const LABEL = { hours: '営業時間', address: '住所', industry: '業種', contact: '連絡先' };
  const CRIT = {
    hours: '営業時間が1日分でも入っていれば5点、入っていなければ1点',
    address: '住所が入っていれば5点、入っていなければ1点',
    industry: '業種が入っていれば5点、入っていなければ1点',
    contact: '電話番号・サイト・SNSのどれか1つでも入っていれば5点、どれも無ければ1点',
  };
  const WHY = {
    hours: '営業時間が分かると、訪問の時間を決めやすい',
    address: '住所がはっきりしていると、場所を確かめて回りやすい',
    industry: '業種が分かると、話の切り口を決めやすい',
    contact: '連絡先があると、訪問の前に連絡や確認ができる',
  };
  const has = (v) => (typeof v === 'string' ? v.trim() !== '' : !!v);
  // 営業時間が1日分でも入っているか（データが無い店は「不明」。定休日とは区別する）
  const hasHoursData = (s) => Object.values(s.hours || {}).some((t) => has(t));
  function itemHas(s, k) {
    if (k === 'hours') return hasHoursData(s);
    if (k === 'address') return has(s.address);
    if (k === 'industry') return has(s.industry);
    return has(s.phone) || has(s.website) || has(s.insta);
  }
  function subScores(s) {
    return Object.fromEntries(KEYS.map((k) => [k, itemHas(s, k) ? 5 : 1]));
  }
  // 根拠：取れている中身だけを書く（無い項目は「データはありません」とだけ）
  function evidence(s, k) {
    if (k === 'hours') return hasHoursData(s) ? '営業時間が曜日ごとに入っています' : '営業時間のデータはありません';
    if (k === 'address') return has(s.address) ? `住所：${s.address}` : '住所のデータはありません';
    if (k === 'industry') return has(s.industry) ? `業種：${s.industry}` : '業種のデータはありません';
    const got = [has(s.phone) && '電話番号', has(s.website) && 'サイト', has(s.insta) && 'SNS'].filter(Boolean);
    return got.length ? `連絡先：${got.join('・')}があります` : '連絡先のデータはありません';
  }

  // 理由の文章：取れている情報だけで作る（無い情報は書かない。評価や口コミには触れない）
  function reasonDetail(s, k) {
    if (k === 'hours') return '営業時間が分かっていて、訪問の時間を決めやすいお店です';
    if (k === 'address') return '住所がはっきりしていて、場所を確かめやすいお店です';
    if (k === 'industry') return `業種は「${s.industry}」で、話の切り口を決めやすいお店です`;
    if (has(s.phone)) return '電話番号が分かっていて、訪問の前に連絡ができます';
    if (has(s.website)) return 'サイトがあり、店の内容を訪問の前に確認できます';
    return 'SNSで店の様子を、訪問の前に確認できます';
  }

  // 理由は最大4つ。取れている項目を先に、次に近さ、最後に店の特徴（閉店の遅さ）
  function buildReasons(s, sub) {
    const list = KEYS.filter((k) => sub[k] === 5).map((k) => reasonDetail(s, k));
    if (s.distance <= 1000 && list.length < 4) {
      const near = s.distance < 300 ? 'すぐ近くにあり' : `現在地から${fmtDist(s.distance)}と近く`;
      list.push(`${near}、移動の負担が少なく回れます`);
    }
    for (const f of featureFill(s)) { if (list.length >= 4) break; list.push(f); }
    if (!list.length) list.push('地図の上で場所が分かっていて、下見がしやすいお店です');
    return list.slice(0, 4);
  }

  // 店のデータから作る、その店らしい特徴（取れているものだけ）：閉店が遅いか
  function featureFill(s) {
    const out = [];
    const closes = Object.values(s.hours || {})
      .map((t) => (typeof t === 'string' ? (t.match(/〜\s*(\d{1,2})/) || [])[1] : null))
      .filter(Boolean).map(Number);
    const latest = closes.length ? Math.max(...closes) : null;
    if (latest != null && latest >= 21) out.push(`閉店が${latest}時と遅く、夜の時間帯にも訪問しやすいお店です`);
    return out;
  }

  function withScores(s) {
    const sub = subScores(s);
    const total5 = KEYS.reduce((a, k) => a + sub[k] * W[k], 0);   // 4項目は必ずどれか（5か1）なので、平均はそのまま
    const overall = Math.round(total5 * 2 * 10) / 10;
    return { ...s, sub, total5, overall, reasons: buildReasons(s, sub) };
  }

  const SORTERS = {
    rec: (a, b) => b.overall - a.overall || a.distance - b.distance,
    dist: (a, b) => a.distance - b.distance,
  };
  // ルート順：並べる元はおすすめ順（出発点を決めるときに使う）。実際の順番は routeList で作る
  SORTERS.route = SORTERS.rec;

  // 2つの店の間の距離（m）。地図と同じ球面距離
  function geoDist(a, b) {
    const R = 6371000, t = Math.PI / 180;
    const dLat = (b.lat - a.lat) * t, dLng = (b.lng - a.lng) * t;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
  }
  const hasPos = (s) => s.lat != null && s.lng != null;
  // ルートの出発点：検索の中心（あれば）→ 現在地 → 一覧の先頭の店 の順
  function routeStart(list) {
    const c = state.searchArgs && state.searchArgs.center;
    if (c && c.lat != null && c.lng != null) return { lat: c.lat, lng: c.lng };
    if (state.area.lat != null && state.area.lng != null) return { lat: state.area.lat, lng: state.area.lng };
    const first = list.find(hasPos);
    return first ? { lat: first.lat, lng: first.lng } : null;
  }
  // ルート順：出発点から、いちばん近い店を順に選ぶ（最近傍法）。そのあと2-opt を1パス（区間を入れ替えて短くなるところを直す）。
  // 位置の無い店は最後に回す。各店に、前の店からの区間距離（leg）を入れる（出発点からの最初の店は、出発点からの距離）
  function routeList(list) {
    const from = routeStart(list);
    const pts = list.filter(hasPos);
    const none = list.filter((s) => !hasPos(s));
    if (!from || !pts.length) return list.map((s) => ({ ...s, leg: null }));
    const left = pts.slice(), seq = [];
    let cur = from;
    while (left.length) {
      let bi = 0, bd = Infinity;
      left.forEach((s, i) => { const d = geoDist(cur, s); if (d < bd) { bd = d; bi = i; } });
      cur = left.splice(bi, 1)[0];
      seq.push(cur);
    }
    // 2-opt（1パス）：出発点は動かさない。途中を反転して、合計が短くなるときだけ入れ替える
    const P = [from, ...seq], n = seq.length;
    for (let i = 1; i <= n - 1; i++) {
      for (let j = i + 1; j <= n; j++) {
        const before = geoDist(P[i - 1], P[i]) + (j < n ? geoDist(P[j], P[j + 1]) : 0);
        const after = geoDist(P[i - 1], P[j]) + (j < n ? geoDist(P[i], P[j + 1]) : 0);
        if (after < before - 1e-6) P.splice(i, j - i + 1, ...P.slice(i, j + 1).reverse());
      }
    }
    const out = [];
    let prev = from;
    P.slice(1).forEach((s) => { out.push({ ...s, leg: geoDist(prev, s) }); prev = s; });
    none.forEach((s) => out.push({ ...s, leg: null }));
    return out;
  }
  // 合計の道のり（ルート順の区間の和）。道のりの表示に使う
  const routeTotal = (list) => list.reduce((a, s) => a + (s.leg || 0), 0);

  // ---------- 状態 ----------
  const today = todayJst();
  const state = {
    area: { mode: 'address', address: '', lat: null, lng: null },
    radius: '1km',
    date: addDays(today, 1), // 訪問する日（デフォルトは翌日・JST）
    category: 'all',         // 検索する分類：'food'（飲食店）／'other'（飲食店以外）／'all'（全て）
    searchArgs: null,        // 最後の検索の中身（追加で取るときに同じ条件で次のページを取る）
    nextPage: 1,             // 次に取るページ（1ページ20件）
    mapSel: null,            // 地図で選ばれている店の id（ピン・一覧・店名をそろえる）
    hasMore: false,          // まだ次のページがあるか（API の hasMore）
    user: null,              // ログイン中の利用者（{name}）。未ログインは null
    blocks: [],
    pool: [],                // 検索で取得した候補（おすすめ点つき）
    poolKey: null,           // その候補を取った検索の条件（エリア・半径・業種・日付）
    poolDay: null,           // その候補を取った日（JST）。前の日の候補は使い回さない
    snap: null,              // 検索時の条件（提案画面の要約用）
    pSort: 'rec',
    pView: 'list',           // 提案の表示：一覧（list）か地図（map）
    pIndustries: new Set(),  // 提案画面の業種絞り込み（空＝全業種）
    pIndOpen: false,         // 業種の一覧を開いているか（最初は閉じる）
    openOnly: true,
    expanded: new Set(),
    visit: [],                   // [{id, shop, visitDate}]。完了報告アプリの訪問リスト（visits）と同じもの（syncVisits で読む）
    later: [],                   // 後で訪問：完了報告の visits（ml_later の印）。syncVisits で読む
    listSort: 'default',
    userPos: null,
  };
  let dateCb = null;

  // ---------- 再読み込みしても消えないように（端末内。検索条件・提案の候補・表示の状態） ----------
  // 訪問予定・後で訪問は完了報告の visits（Firestore）から読むので、ここには入れない。
  // 候補（提案）は、同じ日（JST）のものだけ戻す。前の日の候補は消して、もう一度検索してもらう。
  const UI_KEY = 'ui';
  let uiSaveTimer = null;
  function saveUi() {
    LS.set(UI_KEY, {
      day: today, at: Date.now(),
      area: state.area, radius: state.radius, date: state.date,
      poolKey: state.poolKey, poolDay: state.poolDay,
      category: state.category, searchArgs: state.searchArgs, nextPage: state.nextPage, hasMore: state.hasMore,
      pool: state.pool, snap: state.snap,
      pSort: state.pSort, pView: state.pView, pIndustries: [...state.pIndustries], pIndOpen: state.pIndOpen,
      openOnly: state.openOnly, expanded: [...state.expanded], listSort: state.listSort,
      screen: curScreen,
    });
  }
  function saveUiSoon() { clearTimeout(uiSaveTimer); uiSaveTimer = setTimeout(saveUi, 300); }
  // 古い保存（業種を33業種の名前で持っていた頃）を、今の3択に読み替える。業種の名前は「全て」にする
  function snapFromSaved(snap) {
    if (!snap || typeof snap !== 'object') return null;
    const labels = CATS.map(([, l]) => l);
    return { ...snap, industry: labels.includes(snap.industry) ? snap.industry : '全て' };
  }

  // 戻せたら true。前の日の候補があって消したときは 'stale' を返す
  function restoreUi() {
    const d = LS.get(UI_KEY, null);
    if (!d || typeof d !== 'object') return null;
    const sameDay = d.day === today;
    const arr = (v) => (Array.isArray(v) ? v : []);
    if (d.area && typeof d.area === 'object') state.area = { ...state.area, ...d.area };
    state.radius = radiusKey(d.radius);
    state.date = sameDay && d.date ? d.date : addDays(today, 1);
    state.category = CATS.some(([k]) => k === d.category) ? d.category : 'all';
    state.searchArgs = d.searchArgs || null;
    state.nextPage = Number.isFinite(d.nextPage) ? d.nextPage : 1;
    state.hasMore = d.hasMore === true;
    if (Object.prototype.hasOwnProperty.call(SORTERS, d.pSort)) state.pSort = d.pSort;
    if (d.pView === 'map' || d.pView === 'list') state.pView = d.pView;
    state.pIndustries = new Set(arr(d.pIndustries));
    state.pIndOpen = d.pIndOpen === true;
    if (typeof d.openOnly === 'boolean') state.openOnly = d.openOnly;
    state.expanded = new Set(arr(d.expanded));
    if (typeof d.listSort === 'string') state.listSort = d.listSort;
    if (SCREENS.includes(d.screen)) curScreen = d.screen;
    state.poolKey = typeof d.poolKey === 'string' ? d.poolKey : null;
    state.poolDay = typeof d.poolDay === 'string' ? d.poolDay : null;
    if (sameDay && arr(d.pool).length) { state.pool = d.pool; state.snap = snapFromSaved(d.snap); return 'restored'; }
    return arr(d.pool).length ? 'stale' : 'restored';
  }

  // ---------- 共通の部品 ----------
  const weekRange = (k) => { const d = addDays(today, k); return d; };
  const mapUrl = (s) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.name + ' ' + s.address)}`;
  const fmtDist = (m) => (m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`);
  // 営業時間のデータが無い店は「不明」として、営業中のフィルタで落とさない（定休日とは区別する）
  const isOpenOn = (s, date) => !hasHoursData(s) || !!(s.hours || {})[weekKey(date)];
  const findIn = (list, id) => list.find((x) => x.id === id);
  const findShop = (id) => findIn(state.pool, id) || (findIn(state.visit, id) || {}).shop || (findIn(state.later, id) || {}).shop;
  const inVisit = (id) => state.visit.some((x) => x.id === id);
  const inLater = (id) => state.later.some((x) => x.id === id);

  function distM(a, b) {
    const R = 6371000, rad = (x) => (x * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function hoursRow(s, date) {
    const wk = date ? weekKey(date) : '';
    return `<div class="hours">${DAY_ORDER.map((i) => {
      const k = DAY_KEYS[i];
      const h = (s.hours || {})[k];
      return `<span class="hpill${h ? '' : ' closed'}${k === wk ? ' sel' : ''}"><b>${WD_JP[i]}</b>${h ? esc(h) : '定休日'}</span>`;
    }).join('')}</div>`;
  }

  // ---------- 日付：今日・明日＋カレンダー（月をまたいで選べる） ----------
  // 選べる範囲：2日前〜120日先（JST）
  const DATE_MIN = () => addDays(todayJst(), -2);
  const DATE_MAX = () => addDays(todayJst(), 120);
  const CAL = { search: null, sheet: null }; // 表示中の月（YYYY-MM）
  const CAL_OPEN = { search: false, sheet: false }; // カレンダーを開いているか（普段は閉じている）

  // 選んだ日付だけの簡易表示。タップするとカレンダーが開く（もう一度で閉じる）
  function calToggleHTML(kind, sel) {
    const open = CAL_OPEN[kind];
    return `<button class="cal-toggle${open ? ' open' : ''}" data-act="cal-toggle" data-kind="${kind}" aria-expanded="${open}">
      <span>${fmtDate(sel)}</span>${ic('down')}</button>`;
  }
  let dateCtx = null;                        // 訪問日シートの対象 {id, kind, sel}

  function shiftMonth(ym, d) {
    const [y, m] = ym.split('-').map(Number);
    return ymdOf(new Date(Date.UTC(y, m - 1 + d, 1))).slice(0, 7);
  }

  // 今日・明日のボタン（選ばれている日は縁を光らせる）
  function quickDates(sel, act, extra = '') {
    const t = todayJst();
    return `<div class="quick">${[['今日', t], ['明日', addDays(t, 1)]].map(([l, d]) =>
      `<button class="pill-btn${d === sel ? ' on' : ''}" data-act="${act}" data-date="${d}" ${extra}>${l}　${Number(d.slice(5, 7))}/${Number(d.slice(8))}</button>`).join('')}</div>`;
  }

  // カレンダー（kind は 'search' か 'sheet'）
  function calHTML(kind, sel, act, extra = '') {
    const min = DATE_MIN(), max = DATE_MAX(), t = todayJst();
    if (!CAL[kind]) CAL[kind] = (sel || t).slice(0, 7);
    const ym = CAL[kind];
    const [y, m] = ym.split('-').map(Number);
    const last = ymdOf(new Date(Date.UTC(y, m, 0)));
    const prevOk = last >= min;
    const nextOk = addDays(last, 1) <= max;
    let cells = '';
    for (let i = 0; i < wdOf(`${ym}-01`); i++) cells += '<span></span>';
    for (let day = 1; day <= Number(last.slice(8)); day++) {
      const d = `${ym}-${pad(day)}`;
      const off = d < min || d > max;
      cells += `<button class="cal-day${d === sel ? ' on' : ''}${d === t ? ' today' : ''}" data-act="${act}" data-date="${d}" ${extra}${off ? ' disabled' : ''} aria-label="${fmtDate(d)}">${day}</button>`;
    }
    return `<div class="cal">
      <div class="cal-head">
        <button class="icon-btn cal-nav" data-act="cal-nav" data-kind="${kind}" data-d="-1" ${prevOk ? '' : 'disabled'} aria-label="前の月">${ic('back')}</button>
        <b>${y}年${m}月</b>
        <button class="icon-btn cal-nav" data-act="cal-nav" data-kind="${kind}" data-d="1" ${nextOk ? '' : 'disabled'} aria-label="次の月">${ic('next')}</button>
      </div>
      <div class="cal-grid">${WD_JP.map((w) => `<span class="cal-wd">${w}</span>`).join('')}${cells}</div>
    </div>`;
  }

  // 横にスクロールする行の端に、続きがある合図（グラデーション）を出す
  function markEdges() {
    $$('.hscroll').forEach((el) => {
      const w = el.parentElement;
      if (!w) return;
      const max = el.scrollWidth - el.clientWidth;
      w.classList.toggle('edge-l', el.scrollLeft > 4);
      w.classList.toggle('edge-r', max > 4 && el.scrollLeft < max - 4);
    });
  }
  root.addEventListener('scroll', (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('hscroll')) markEdges();
  }, true);
  window.addEventListener('resize', markEdges);

  // （旧）日付チップ行。新しい日付の表示では使わない
  function dateStrip(sel, act, extra = '') {
    const t = todayJst();
    let h = '';
    for (let k = -2; k <= 7; k++) {
      const d = addDays(t, k);
      const lab = k === 0 ? '今日' : k === 1 ? '明日' : ' ';
      h += `<button class="dchip${d === sel ? ' on' : ''}" data-act="${act}" data-date="${d}" ${extra}><small>${lab}</small><b>${Number(d.slice(5, 7))}/${Number(d.slice(8))}</b><span>${WD_JP[wdOf(d)]}</span></button>`;
    }
    return `<div class="dstrip">${h}</div>`;
  }

  function copyText(text, msg = 'コピーしました') {
    const fallback = () => {
      const t = document.createElement('textarea');
      t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      t.remove();
      toast(ok ? msg : 'コピーできませんでした');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => toast(msg), fallback);
    } else fallback();
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  function openSheet(title, html) {
    const sheet = $('#sheet');
    sheet.innerHTML = `<div class="scrim" data-close></div><section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="閉じる">${ic('x')}</button></header><div class="sheet-body">${html}</div></section>`;
    sheet.hidden = false;
    root.host.classList.add('lock'); // 開いている間は、後ろの画面を動かさない（完了報告アプリ側のクラス）
    return sheet;
  }
  function closeSheet() {
    const sheet = $('#sheet');
    sheet.hidden = true;
    sheet.innerHTML = '';
    root.host.classList.remove('lock');
    dateCb = null;
  }

  // ---------- 検索画面 ----------
  function renderArea() {
    const a = state.area;
    $('#s-area').innerHTML = `
      <div class="seg two">
        <button class="${a.mode === 'address' ? 'on' : ''}" data-act="area-mode" data-v="address">住所・町名</button>
        <button class="${a.mode === 'gps' ? 'on' : ''}" data-act="area-mode" data-v="gps">現在地</button>
      </div>
      ${a.mode === 'address'
        ? `<label class="field"><span class="sr">住所・町名</span><input id="addr" type="text" placeholder="例：〇〇区〇〇" value="${esc(a.address)}" autocomplete="off"></label>`
        : `<button class="btn wide" data-act="gps">${ic('gps')}${a.lat == null ? '現在地を取得する' : '現在地を取得済み（取り直す）'}</button>
           ${a.lat == null ? '<p class="hint">位置情報を許可すると、今いる場所の周りから探します。</p>' : hereHTML(a)}`}`;
  }
  // 取った現在地の住所（何県・何市・何町）を、ボタンの下にはっきり出す。調べ中・取れなかったときも分かるように
  function hereHTML(a) {
    const name = a.place ? esc(a.place) : (a.place === '' ? '住所は取れませんでした' : '住所を調べています…');
    return `<div class="here" aria-live="polite">
        <span class="here-label">${ic('gps')}今いる場所</span>
        <strong class="here-name">${name}</strong>
        <p class="hint">この場所の周りから探します。</p>
      </div>`;
  }

  function renderRadius() {
    $('#s-radius').innerHTML = `<div class="hwrap"><div class="seg scroll hscroll">${RADIUS.map(([k, l]) =>
      `<button class="${state.radius === k ? 'on' : ''}" data-act="radius" data-v="${k}">${l}</button>`).join('')}</div></div>`;
  }

  function renderDate() {
    const el = $('#s-date');
    el.innerHTML = `${calToggleHTML('search', state.date)}${quickDates(state.date, 'search-date')}${CAL_OPEN.search ? calHTML('search', state.date, 'search-date') : ''}`;
  }

  // 業種は3択（飲食店・飲食店以外・全て）。細かい業種の選択はやめた
  function renderInd() {
    const hint = { food: '飲食店だけを探します', other: '飲食店以外を探します', all: '飲食店と、それ以外の店を探します' }[state.category];
    $('#s-ind').innerHTML = `
      <div class="seg three" role="tablist">${CATS.map(([k, l]) =>
        `<button class="${state.category === k ? 'on' : ''}" data-act="cat" data-v="${k}" role="tab" aria-selected="${state.category === k}">${l}</button>`).join('')}</div>
      <p class="hint">${hint}</p>`;
  }


  // ---------- 提案リスト ----------
  function visibleList() {
    let list = state.pool.slice().sort(SORTERS[state.pSort] || SORTERS.rec);
    if (state.pIndustries.size) list = list.filter((s) => state.pIndustries.has(s.industry));
    if (state.openOnly) list = list.filter((s) => isOpenOn(s, state.date));
    // ルート順は、絞り込みのあとの店で、毎回作り直す（業種や営業中の変更にも合う）
    if (state.pSort === 'route') list = routeList(list);
    return list; // 件数の指定はなし。候補（1ページ目の20件・追加ぶんも含む）すべてから作る
  }
  // 距離の表示：ルート順のときは、前の店からの区間距離（出発点からの最初の店は、その距離）
  const legText = (s) => (state.pSort === 'route' ? (s.leg == null ? '—' : fmtDist(s.leg)) : fmtDist(s.distance));

  function renderProposal() {
    const sn = state.snap;
    // 並び替えは、完了報告アプリの上のバーに出す（その並びの印を合わせる）
    window.dispatchEvent(new CustomEvent('ml-proposal', { detail: { sort: state.pSort } }));
    if (!sn) {
      $('#pSummary').textContent = 'まだ提案がありません。';
      $('#pView').innerHTML = '';
      $('#pInd').innerHTML = '';
      $('#pOpenLabel').textContent = '';
      $('#pList').innerHTML = `<div class="empty"><p>まだ提案がありません。</p><button class="btn primary" data-act="go-search">条件を決める</button></div>`;
      return;
    }
    $('#pSummary').textContent = `${sn.area}／半径 ${sn.radius}／候補 ${state.pool.length}件／訪問日 ${fmtDate(state.date)}／${sn.industry}`;
    // 一覧／地図の切り替えは、画面の下のドックに出す
    $('#pView').innerHTML = [['list', '一覧'], ['map', '地図で見る']].map(([k, l]) =>
      `<button class="${state.pView === k ? 'on' : ''}" data-act="p-view" data-v="${k}">${l}</button>`).join('');

    const inds = [...new Set(state.pool.map((s) => s.industry))];
    $('#pInd').innerHTML = inds.map((n) => `<button class="chip${state.pIndustries.has(n) ? ' on' : ''}" data-act="p-ind" data-name="${esc(n)}">${esc(n)}</button>`).join('')
      || '<p class="hint">候補がありません</p>';
    // 業種は折りたたみ。閉じているときも、選んだ業種が分かるように小さく出す
    const picked = [...state.pIndustries];
    $('#pIndSum').textContent = picked.length ? `${picked.slice(0, 2).join('・')}${picked.length > 2 ? ` ほか${picked.length - 2}件` : ''}` : '全業種';
    $('#pIndFold').open = !!state.pIndOpen;

    $('#pOpenLabel').textContent = `${fmtDate(state.date)}営業している店のみ`;
    const sw = $('#pOpen');
    sw.setAttribute('aria-checked', String(state.openOnly));

    const list = visibleList();
    if (state.pView === 'map') {
      $('#pList').innerHTML = mapPanelHTML(list) + moreHTML();
      mountMap(list);
      return;
    }
    dropInline();   // 一覧に戻すときは、地図を外す
    $('#pList').innerHTML = (list.length
      ? list.map((s, i) => proposalCard(s, i + 1)).join('')
      : `<div class="empty"><p>条件に合う店がありませんでした。</p><p class="hint">半径を広げるか、条件を変えてもう一度お試しください。</p></div>`) + moreHTML();
  }

  function overallDetail(s) {
    const rows = KEYS.map((k) => `<tr><td>${LABEL[k]}</td><td>${s.sub[k]}点・重み${Math.round(W[k] * 100)}%</td><td>${(s.sub[k] * W[k]).toFixed(2)}</td></tr>`).join('');
    return `<div class="detail"><p class="detail-title">点数の計算</p>
      <table class="calc">${rows}
        <tr class="sum"><td>合計（5点満点）</td><td></td><td>${s.total5.toFixed(2)}</td></tr>
        <tr class="sum"><td>10点満点にする</td><td>2倍</td><td>${s.overall.toFixed(1)}</td></tr>
      </table>
      <p class="hint">4項目の重み：営業時間・住所・業種・連絡先は各25%。ある項目は5点、ない項目は1点です（店の情報は OpenStreetMap から）。</p></div>`;
  }

  function scoreDetail(s, k) {
    const score = `${s.sub[k]}点／5点`;
    return `<div class="detail"><p class="detail-title">${LABEL[k]}：${score}</p>
      <dl><dt>根拠</dt><dd>${esc(evidence(s, k))}</dd>
      <dt>理由</dt><dd>${esc(WHY[k])}</dd>
      <dt>点数の決め方（基準）</dt><dd>${esc(CRIT[k])}</dd></dl></div>`;
  }

  function proposalCard(s, rank) {
    const open = isOpenOn(s, state.date);
    const exp = (k) => state.expanded.has(s.id + ':' + k);
    const inList = inVisit(s.id) || inLater(s.id);
    const banner = s.visited
      ? `<div class="banner">${ic('info')}訪問済みの店です</div>`
      : inList ? `<div class="banner">${ic('info')}訪問予定に入っています</div>` : '';
    return `<article class="card shop">
      ${banner}
      <div class="shop-head">
        <span class="rank">${rank}位</span><span class="tag">${esc(s.industry)}</span>
        <button class="overall${exp('overall') ? ' open' : ''}" data-act="p-expand" data-id="${s.id}" data-k="overall" aria-label="${s.overall.toFixed(1)}点（詳しく見る）"><b>${s.overall.toFixed(1)}</b><small>/ 10</small></button>
      </div>
      <h3 class="shop-name">${esc(s.name)}</h3>
      ${exp('overall') ? overallDetail(s) : ''}
      <div class="scores">${KEYS.map((k) => `<button class="score${exp(k) ? ' open' : ''}" data-act="p-expand" data-id="${s.id}" data-k="${k}"><span>${LABEL[k]}</span><b>${s.sub[k] == null ? '—' : s.sub[k]}</b><small>/5</small></button>`).join('')}</div>
      ${KEYS.map((k) => (exp(k) ? scoreDetail(s, k) : '')).join('')}
      <ul class="reasons">${s.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      <p class="meta">${ic('pin')}<span>${esc(s.address)}</span></p>
      <div class="meta-row">
        <span class="dist">${state.pSort === 'route' ? '前から ' : ''}${legText(s)}</span>
        ${!hasHoursData(s) ? '<span class="vtime">営業時間は不明</span>' : open ? `<span class="vtime">${esc((s.hours || {})[weekKey(state.date)])}</span>` : '<span class="vtime closed">選択日は定休日</span>'}
        ${s.insta ? `<a class="pill-btn" href="https://www.instagram.com/${esc(s.insta)}" target="_blank" rel="noopener">${ic('insta')}@${esc(s.insta)}</a>` : ''}
      </div>
      <div class="actions">
        <button class="btn" data-act="add" data-id="${s.id}" ${inVisit(s.id) ? 'disabled' : ''}>${ic('plus')}${inVisit(s.id) ? '追加済み' : '訪問予定に追加'}</button>
        <button class="btn" data-act="copy-map" data-id="${s.id}">${ic('copy')}Map URLコピー</button>
        <a class="btn icon" href="${esc(mapUrl(s))}" target="_blank" rel="noopener" aria-label="地図で開く">${ic('map')}</a>
        <button class="btn text" data-act="block" data-id="${s.id}">${ic('block')}訪問NG</button>
      </div>
    </article>`;
  }

  // ---------- 訪問リスト・後で訪問 ----------
  function visitCard(it, kind) {
    const s = it.shop;
    const date = it.visitDate;
    const dateTag = date ? `<span class="vdate">${fmtDate(date)}</span>` : '<span class="vdate none">日付未定</span>';
    const common = `
      <button class="btn" data-act="copy-map" data-id="${s.id}">${ic('copy')}Map URLコピー</button>
      <a class="btn icon" href="${esc(mapUrl(s))}" target="_blank" rel="noopener" aria-label="地図で開く">${ic('map')}</a>`;
    const actions = kind === 'visit'
      ? `${common}<button class="btn" data-act="later-move" data-id="${s.id}">後で訪問</button>
         <button class="btn danger" data-act="remove" data-src="visit" data-id="${s.id}">${ic('x')}外す</button>`
      : `<button class="btn" data-act="back-visit" data-id="${s.id}">${ic('back')}訪問予定に戻す</button>
         ${common}
         <button class="btn danger" data-act="remove" data-src="later" data-id="${s.id}">${ic('x')}外す</button>`;
    return `<article class="card visit">
      <div class="visit-top">${dateTag}<button class="pill-btn" data-act="pick-date" data-id="${s.id}" data-kind="${kind}">${ic('cal')}日付を変える</button></div>
      <h3 class="shop-name">${esc(s.name)}</h3>
      <div class="row"><span class="tag">${esc(s.industry)}</span></div>
      <p class="meta">${ic('pin')}<span>${esc(s.address)}</span></p>
      ${hoursRow(s, date)}
      <div class="actions">${actions}</div>
    </article>`;
  }

  function sortForList(items) {
    if (state.listSort === 'dist' && state.userPos) {
      return items.slice().sort((a, b) => distM(state.userPos, a.shop) - distM(state.userPos, b.shop));
    }
    return items;
  }

  function renderVisitList() {
    const items = state.visit;
    $('#lCount').textContent = `${items.length}件`;
    if (!items.length) {
      $('#lList').innerHTML = `<div class="empty"><p>訪問予定は空です。</p><p class="hint">提案リストから店を追加できます。</p></div>`;
      return;
    }
    const groups = new Map();
    items.forEach((it) => {
      const k = it.visitDate || '';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(it);
    });
    const keys = [...groups.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a < b ? -1 : a > b ? 1 : 0));
    $('#lList').innerHTML = keys.map((k) => {
      const list = sortForList(groups.get(k));
      return `<h2 class="date-head">${k ? fmtDate(k) : '日付未定'}<span class="cnt">${list.length}件</span></h2>${list.map((it) => visitCard(it, 'visit')).join('')}`;
    }).join('');
  }

  function renderLaterList() {
    const items = state.later;
    $('#gCount').textContent = `${items.length}件`;
    $('#gList').innerHTML = items.length
      ? items.map((it) => visitCard(it, 'later')).join('')
      : `<div class="empty"><p>後で訪問の店はありません。</p><p class="hint">訪問予定の「後で訪問」から移せます。</p></div>`;
  }

  // 下のタブは、完了報告アプリの下のタブ（同じ棒・同じ見た目）を使う。ここでは作らない（app.js の mlTabs）
  function renderNav() {}
  function renderBadges() {
    const n = { list: state.visit.length, later: state.later.length };
    $$('[data-badge]').forEach((el) => { const c = n[el.dataset.badge]; el.textContent = c ? String(c) : ''; });
  }

  // ---------- ログイン（Googleログインのみ） ----------
  function renderAccount() {
    const el = $('#account');
    if (!el) return;
    const u = state.user;
    el.innerHTML = u
      ? `<div class="acct"><div class="acct-who"><span class="sub">ログイン中</span><b>${esc(u.name)}</b></div>
           <button class="btn small" data-act="logout">ログアウト</button></div>`
      : `<div class="acct"><div class="acct-who"><span class="sub">ログインしてください</span></div>
           <button class="btn small" data-act="login">Googleでログイン</button></div>`;
  }

  // ログインの状態を読み直す（未ログインなら一覧は空・候補も消す）
  // 後から始めた読み直しを優先する（古い結果が新しいログイン結果を上書きしない）
  let userSeq = 0;
  async function refreshUser() {
    const mine = ++userSeq;
    let user = null;
    try {
      const u = await D.currentUser();
      user = u ? { name: u.displayName || u.email || 'ログイン中' } : null;
    } catch (e) {
      user = null;
    }
    if (mine !== userSeq) return; // より新しい読み直しがあれば、この結果は捨てる
    state.user = user;
    state.blocks = await D.getBlocks(); // 未ログインでも、この端末の訪問NGを使う
    renderAll();
  }

  async function login() {
    try {
      await D.signIn();
      await refreshUser();
      if (state.user) toast('ログインしました');
    } catch (e) {
      toast(e && e.code === 'auth/popup-closed-by-user' ? 'ログインを中止しました' : 'ログインできませんでした。もう一度お試しください');
    }
  }

  async function logout() {
    try {
      await D.signOut();
      await refreshUser();
      toast('ログアウトしました');
    } catch (e) {
      toast('ログアウトできませんでした。もう一度お試しください');
    }
  }

  function renderAll() {
    renderAccount();
    requestAnimationFrame(markEdges);
    renderArea(); renderRadius(); renderDate(); renderInd();
    renderProposal(); renderVisitList(); renderLaterList(); renderBadges();
  }

  // ---------- 画面の切り替え ----------
  // 画面の名前は、この画面の中で持つ（完了報告アプリの URL の # は使わない）
  let curScreen = 'search';
  function currentName() {
    return SCREENS.includes(curScreen) ? curScreen : 'search';
  }
  function showScreen() {
    const name = currentName();
    $$('.screen').forEach((s) => s.classList.toggle('active', s.dataset.screen === name));
    renderAll();
    window.scrollTo(0, 0);
    // 下のタブ（完了報告アプリの棒）の選ばれている印を合わせる
    window.dispatchEvent(new CustomEvent('ml-screen', { detail: name }));
  }
  function go(name) {
    curScreen = name;
    showScreen();
  }

  // ---------- 検索の実行 ----------
  // 検索の条件（件数は持たない。提案は取れている候補（1ページ目20件＋追加ぶん）から作る）
  function searchKey() {
    const a = state.area;
    return JSON.stringify({
      mode: a.mode,
      where: a.mode === 'address' ? a.address.trim() : [a.lat, a.lng],
      radius: state.radius,
      category: state.category,
      date: state.date,
    });
  }

  async function runSearch() {
    const a = state.area;
    let center, viewport = null;
    const key = searchKey();
    // 同じ条件・同じ日なら、検索せず、保存してある候補から作る（再検索の回数を減らす）
    if (key === state.poolKey && state.poolDay === todayJst() && state.pool.length) {
      const blocked0 = new Set(state.blocks.map((b) => b.id));
      state.pool = state.pool.filter((s) => !blocked0.has(s.id));
      go('proposal');
      saveUiSoon();
      toast('保存してある候補から作りました（検索はしていません）');
      return;
    }
    const btn = $('[data-act="run-search"]');
    btn.disabled = true; btn.textContent = '探しています…';
    try {
      if (a.mode === 'address') {
        const text = a.address.trim();
        if (!text) return toast('住所か町名を入力してください');
        center = await D.geocode(text);
        if (!center) return toast('場所が見つかりませんでした');
        viewport = center.viewport || null;
      } else {
        if (a.lat == null) return toast('先に現在地を取得してください');
        center = { lat: a.lat, lng: a.lng };
      }
      const town = state.radius === 'town';
      const radiusM = RADIUS.find((r) => r[0] === state.radius)[2];
      // 最初は1ページ目（20件）だけ。次のページは「追加で20件を見る」で取る
      const args = { center, radius: radiusM, town, viewport: town ? viewport : null, category: state.category };
      const { shops: raw, hasMore } = await D.searchShops({ ...args, page: 1 });
      const blocked = new Set(state.blocks.map((b) => b.id));
      state.pool = raw.filter((s) => !blocked.has(s.id)).map(withScores);
      state.searchArgs = args;
      state.nextPage = 2;
      state.hasMore = hasMore && 1 < MAX_PAGES;
      state.poolKey = key;
      state.poolDay = todayJst();
      state.snap = {
        area: a.mode === 'address' ? a.address.trim() : '現在地',
        radius: RADIUS.find((r) => r[0] === state.radius)[1],
        industry: catLabel(state.category),
      };
      state.pIndustries = new Set();   // 手元の候補を絞る業種は、検索のたびに全部に戻す
      state.openOnly = true;
      state.expanded = new Set();
      go('proposal');
      saveUiSoon();
    } catch (e) {
      toast(e && e.message ? e.message : '取得に失敗しました。時間をおいてもう一度お試しください');
    } finally {
      btn.disabled = false; btn.textContent = '提案リストを作る';
    }
  }

  // 「追加で20件を見る」：同じ条件で次のページを取り、候補と提案に足す（自動では取りに行かない）
  async function loadMore() {
    if (!state.hasMore || !state.searchArgs || !state.pool.length) return;
    const page = state.nextPage;
    const btn = $('[data-act="more-results"]');
    if (btn) { btn.disabled = true; btn.textContent = '取りに行っています…'; }
    try {
      const { shops, hasMore } = await D.searchShops({ ...state.searchArgs, page });
      const blocked = new Set(state.blocks.map((b) => b.id));
      const have = new Set(state.pool.map((s) => s.id));
      const add = shops.filter((s) => !blocked.has(s.id) && !have.has(s.id)).map(withScores);
      state.pool = state.pool.concat(add);
      state.nextPage = page + 1;
      state.hasMore = hasMore && page < MAX_PAGES;
      renderProposal();
      saveUiSoon();
      toast(add.length ? `${add.length}件増えました` : '新しい候補はありませんでした');
    } catch (e) {
      renderProposal();
      toast((e && e.message) || '追加で取れませんでした。もう一度お試しください');
    }
  }

  // 提案リストの下の「追加で20件を見る」（次がないときは押せない表示）
  function moreHTML() {
    if (!state.searchArgs || !state.pool.length) return '';
    return state.hasMore
      ? `<div class="more"><button class="btn wide" data-act="more-results">追加で20件を見る</button>
           <p class="hint">いま${state.pool.length}件。押したときだけ、次の20件を取りに行きます（1分類は60件まで）</p></div>`
      : `<div class="more"><button class="btn wide" disabled>これ以上の候補はありません</button>
           <p class="hint">1分類あたり60件までです（いま${state.pool.length}件）</p></div>`;
  }

  function locate(done) {
    if (!navigator.geolocation) return toast('この端末では現在地を使えません');
    toast('現在地を取得しています');
    navigator.geolocation.getCurrentPosition((p) => {
      state.area.lat = p.coords.latitude;
      state.area.lng = p.coords.longitude;
      state.area.place = null;
      state.userPos = { lat: p.coords.latitude, lng: p.coords.longitude };
      renderArea();
      toast('現在地を取得しました');
      saveUiSoon();
      resolvePlace();
      if (done) done();
    }, () => toast('現在地を取得できませんでした'), { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  }

  // 現在地の住所（何県・何市・何町）を取る。取れたら表示して端末に保存する。取れなければ「取れませんでした」と出す
  function resolvePlace() {
    const at = { lat: state.area.lat, lng: state.area.lng };
    if (at.lat == null) return;
    const same = () => state.area.lat === at.lat && state.area.lng === at.lng; // 取り直していたら、古い結果は捨てる
    state.area.place = null;
    renderArea();
    D.placeName(at).then((name) => {
      if (!same()) return;
      state.area.place = name || '';
      renderArea();
      saveUiSoon();
    }).catch(() => {
      if (!same()) return;
      state.area.place = '';
      renderArea();
      saveUiSoon();
    });
  }

  // ---------- 日付選択 ----------
  function openDatePick(id, kind) {
    const it = findIn(kind === 'later' ? state.later : state.visit, id);
    if (!it) return;
    dateCb = (d) => setVisitDate(id, d, kind);
    dateCtx = { id, kind, sel: it.visitDate || state.date };
    CAL.sheet = null; // 選ばれている日の月から表示
    CAL_OPEN.sheet = false; // 普段は閉じておく
    openSheet('訪問予定日', '<div id="dateBody"></div>');
    renderDateSheet();
  }

  // 訪問日シートの中身（今日・明日＋カレンダー）
  function renderDateSheet() {
    const el = $('#dateBody');
    if (!el || !dateCtx) return;
    const { id, kind, sel } = dateCtx;
    const extra = `data-id="${id}" data-kind="${kind}"`;
    el.innerHTML = `${calToggleHTML('sheet', sel)}${quickDates(sel, 'dpick', extra)}${CAL_OPEN.sheet ? calHTML('sheet', sel, 'dpick', extra) : ''}
      <div class="stack"><button class="btn text wide" data-act="dpick-none" data-id="${id}" data-kind="${kind}">日付未定にする</button></div>`;
  }

  async function setVisitDate(id, date) {
    try {
      await D.visits.setDate(id, date); // 訪問リスト・後で訪問とも、同じ visits の日付を変える
    } catch (e) {
      toast((e && e.message) || '日付を変えられませんでした。もう一度お試しください');
    }
    // 表示は、完了報告アプリの変更を受けて読み直す（dc-visits-changed）
  }

  // ---------- 訪問リストの操作 ----------
  // 保存は、完了報告アプリの visits に対して行う（この端末には何も保存しない）
  function saveAll() {}

  // 訪問リストと後で訪問の読み直し（完了報告アプリの visits が変わったとき・画面を開いたとき）
  function syncVisits() {
    state.visit = D.visits.list();
    state.later = D.visits.laterList();
  }

  function addVisit(id) {
    const s = findIn(state.pool, id) || findShop(id);
    if (!s || inVisit(id)) return;
    D.visits.add(stripScores(s), state.date)
      .then(() => toast('訪問予定に追加しました'))
      .catch((e) => toast((e && e.message) || '訪問予定に追加できませんでした。もう一度お試しください'));
  }

  function stripScores(s) {
    const { sub, total5, overall, reasons, ...rest } = s; // 一覧に必要な店の情報だけ残す
    return rest;
  }

  // 訪問リスト ⇄ 後で訪問。訪問リストに出し入れするときは、完了報告アプリの visits を変える
  async function moveList(id, from, to) {
    const src = from === 'visit' ? state.visit : state.later;
    const it = findIn(src, id);
    if (!it) return;
    try {
      // 同じ訪問のまま、後で訪問の印だけを付け外しする（訪問リストと同じデータ）
      await D.visits.setLater(id, to === 'later');
      syncVisits();
      toast(to === 'later' ? '後で訪問に移しました' : '訪問予定に戻しました');
    } catch (e) {
      toast((e && e.message) || '移せませんでした。もう一度お試しください');
    }
    renderAll();
  }

  async function removeFrom(id, src) {
    if (!window.confirm('この店を外しますか？')) return;
    try {
      await D.visits.remove(id); // 訪問リストでも後で訪問でも、同じ visits から外す
      toast('外しました');
    } catch (e) {
      toast((e && e.message) || '外せませんでした。もう一度お試しください');
    }
    renderAll();
  }

  function copyAll(src) {
    const list = src === 'visit' ? state.visit : state.later;
    if (!list.length) return toast('コピーする店がありません');
    const text = list.map((x, i) => `${i + 1}. ${x.shop.name}\n${mapUrl(x.shop)}`).join('\n\n');
    copyText(text, `${list.length}件のリンクをコピーしました`);
  }

  function sortByDistance() {
    const apply = () => { state.listSort = 'dist'; renderVisitList(); toast('近い順に並べました'); };
    if (state.userPos) return apply();
    locate(apply);
  }

  // ---------- 訪問NG（永久ブロック） ----------
  // ログインしていない人への案内（訪問NGは、メンバーがログインしたときだけ使える）
  function openLoginPrompt(message) {
    openSheet('ログインが必要です', `
      <p class="sub">${esc(message)}</p>
      <p class="hint">検索や提案リストは、ログインしなくても使えます。</p>
      <div class="stack">
        <button class="btn primary wide" data-act="login-from-sheet">Googleでログイン</button>
        <button class="btn text wide" data-close>あとで</button>
      </div>`);
  }

  function openBlockSheet(id) {
    if (!state.user) return openLoginPrompt('訪問NGの登録には、ログインが必要です。');
    const s = findShop(id);
    if (!s) return;
    openSheet('訪問NGに登録', `<p class="sub">${esc(s.name)}</p>
      <p class="hint">登録すると、以降の提案から永久に除外されます。</p>
      <div class="stack">
        ${REASONS_BLOCK.map((r) => `<button class="btn wide" data-act="block-reason" data-id="${id}" data-r="${esc(r)}">${esc(r)}</button>`).join('')}
        <button class="btn text wide" data-close>スキップ</button>
      </div>`);
  }

  async function doBlock(id, reason) {
    const s = findShop(id);
    if (!s) return;
    state.blocks = await D.addBlock({ id, name: s.name, reason, at: Date.now() });
    state.pool = state.pool.filter((x) => x.id !== id);
    closeSheet();
    toast('訪問NGに登録しました');
    renderAll();
  }

  async function openBlockList() {
    if (!state.user) return openLoginPrompt('訪問NGの一覧は、ログインすると見られます。');
    state.blocks = await D.getBlocks();
    const body = state.blocks.length
      ? `<ul class="blist">${state.blocks.map((b) => `<li><div><b>${esc(b.name)}</b><small>${esc(b.reason)}</small></div>
          <button class="btn small" data-act="unblock" data-id="${esc(b.id)}">解除</button></li>`).join('')}</ul>`
      : '<p class="hint">登録した店はありません</p>';
    openSheet('訪問NG一覧', body);
  }

  async function unblock(id) {
    state.blocks = await D.removeBlock(id);
    toast('解除しました（次の検索から表示されます）');
    renderSearchBlocks();
    openBlockList();
  }

  // ---------- 地図で見る（店の位置を番号つきのピンで並べる） ----------
  // 番号：1, 2, 3 … と数字で続ける（9の次は10）。2けたのときは、ピンの文字を小さくして枠に収める
  const pinLabel = (i) => String(i + 1);
  const pinClass = (i) => (i + 1 > 9 ? " two" : "");
  const SORT_LABEL = { rec: 'おすすめ順', dist: '近い順', route: 'ルート順' };
  // ---------- 地図（対話式：Leaflet＋OpenStreetMap。店は番号つきのピン。自分の位置は青い点） ----------
  // 指で動かして拡大縮小できる。ピンか一覧の店を押すと、その店が選ばれる（ピン・一覧・店名を同じにそろえる）
  const MAP_TILE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const MAP_ATTR = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>';
  let leafletReady = null;
  let inlineMap = null;          // 提案リストの中の地図
  let fullMap = null;            // 全画面の地図（開いているときだけ）
  const mapSets = new Set();     // 開いている地図（選んだ店を、どの地図にも出すため）

  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (!leafletReady) {
      leafletReady = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = '/vendor/leaflet/leaflet.js';
        s.onload = () => (window.L ? res(window.L) : rej(new Error('地図を読み込めませんでした')));
        s.onerror = () => rej(new Error('地図を読み込めませんでした。時間をおいてもう一度お試しください'));
        document.head.appendChild(s);
      });
    }
    return leafletReady;
  }
  // 地図の見た目（Leaflet の css）は、この画面（シャドウ）の中だけに入れる（完了報告の画面には効かせない）
  function ensureLeafletCss() {
    if (root.querySelector('link[data-leaflet]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = '/vendor/leaflet/leaflet.css';
    l.dataset.leaflet = '1';
    root.appendChild(l);
  }

  function selText(list) {
    const s = list.find((x) => x.id === state.mapSel);
    return s ? `${esc(s.name)}　<small>${fmtDist(s.distance)}</small>` : '店のピンを押すと、ここに店名が出ます';
  }

  function mapPanelHTML(list) {
    if (!list.length) return `<div class="empty"><p>条件に合う店がありませんでした。</p></div>`;
    const routeHint = state.pSort === 'route'
      ? `ルートの合計は約${fmtDist(routeTotal(list))}です（出発点から、番号の順に回ります）。`
      : `並び順は「${SORT_LABEL[state.pSort]}」です。番号の順に回ると効率的です。`;
    return `<div class="map-card">
      <div class="map-box" id="mapBox"><p class="hint">地図を読み込んでいます…</p></div>
      <div class="map-tools"><button class="pill-btn" data-act="map-full">${ic('ext')}全画面で見る</button></div>
      <p class="map-sel" id="mapSel">${selText(list)}</p>
      <p class="hint">${routeHint}</p>
      <ol class="map-order">${list.map((s, i) => `<li class="${state.mapSel === s.id ? 'on' : ''}" data-act="map-pick" data-id="${esc(s.id)}"><span class="pin-no${pinClass(i)}">${pinLabel(i)}</span><span class="map-name">${esc(s.name)}</span><small>${state.pSort === 'route' ? '前から ' : ''}${legText(s)}</small></li>`).join('')}</ol>
    </div>`;
  }

  function pinIcon(L, label, id) {
    return L.divIcon({
      className: 'lp-wrap',
      html: `<span class="lp-pin${label.length > 1 ? ' two' : ''}${state.mapSel === id ? ' on' : ''}">${label}</span>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
  }

  // 地図を作る：店の番号ピン・自分の位置（取得済みのときだけ）。全部が入るように広さを合わせる。
  // ルート順のときは、出発点から①②…へ線で結ぶ
  function buildMap(el, list) {
    const L = window.L;
    const baseClass = el.getAttribute("class") || "";   // Leaflet を付ける前の印（外すときに戻す）
    const map = L.map(el, { zoomControl: true, attributionControl: false, minZoom: 3, maxZoom: 19 });
    // 帰属表示は「© OpenStreetMap contributors」だけ残す（Leaflet の名前は外して、小さく）
    L.control.attribution({ prefix: false }).addTo(map);
    L.tileLayer(MAP_TILE, { maxZoom: 19, attribution: MAP_ATTR }).addTo(map);
    const markers = new Map();
    const pts = [];
    list.forEach((s, i) => {
      if (!hasPos(s)) return;
      const m = L.marker([s.lat, s.lng], { icon: pinIcon(L, pinLabel(i), s.id), keyboard: false, title: s.name }).addTo(map);
      m.on('click', () => selectShop(s.id, false));
      markers.set(s.id, m);
      pts.push([s.lat, s.lng]);
    });
    if (state.pSort === 'route') {
      const from = routeStart(list);
      const line = from ? [[from.lat, from.lng]] : [];
      list.forEach((s) => { if (hasPos(s)) line.push([s.lat, s.lng]); });
      if (line.length > 1) L.polyline(line, { color: '#7DD3FF', weight: 3, opacity: .85, dashArray: '6 6', interactive: false }).addTo(map);
    }
    if (state.area.lat != null && state.area.lng != null) {
      L.marker([state.area.lat, state.area.lng], {
        icon: L.divIcon({ className: 'lp-wrap', html: '<span class="lp-me" title="いまの位置"></span>', iconSize: [20, 20], iconAnchor: [10, 10] }),
        interactive: false,
        keyboard: false,
      }).addTo(map);
      pts.push([state.area.lat, state.area.lng]);
    }
    if (pts.length > 1) map.fitBounds(pts, { padding: [28, 28], maxZoom: 17 });
    else if (pts.length === 1) map.setView(pts[0], 16);
    else map.setView([35.68, 139.76], 12);
    const entry = { map, markers, el, baseClass };
    mapSets.add(entry);
    return entry;
  }

  // 地図を外す。Leaflet は要素の中身と印（leaflet-container）を残すことがあるので、元の要素に戻す（二重に数えられないように）
  function dropMap(entry) {
    if (!entry) return;
    mapSets.delete(entry);
    entry.map.remove();
    entry.el.setAttribute("class", entry.baseClass);
    entry.el.innerHTML = "";
    if (inlineMap === entry) inlineMap = null;
  }

  function dropInline() { if (inlineMap) dropMap(inlineMap); }

  // 提案リストの中の地図を出す。描き直しが重なったら、いちばん新しい一回だけ残す（同じ要素に二重に作らない）
  let mapGen = 0;
  async function mountMap(list) {
    const gen = ++mapGen;
    dropInline();
    const el = $('#mapBox');
    if (!el) return;
    ensureLeafletCss();
    try { await loadLeaflet(); } catch (e) { if (gen === mapGen && $('#mapBox')) $('#mapBox').innerHTML = `<p class="hint">${esc(e.message)}</p>`; return; }
    if (gen !== mapGen) return;            // 待っている間に、もっと新しい描き直しが始まった
    if (fullMap || fullOpening) return;    // 全画面を開いている間は、提案の地図を出さない（二重になるため）
    if (state.pView !== 'map') return;
    dropInline();
    let box = $('#mapBox');
    if (!box) return;
    if (box._leaflet_id) { const fresh = box.cloneNode(false); box.replaceWith(fresh); box = fresh; } // Leaflet が使い終えていない要素は作り直す
    try { inlineMap = buildMap(box, list); } catch (e) { box.innerHTML = '<p class="hint">地図を出せませんでした。もう一度お試しください</p>'; return; }
    selectShop(state.mapSel, false);
  }

  // 店を選ぶ：ピン・一覧・下の店名を、同じにそろえる（pan=true なら、地図もその店へ動かす）
  function selectShop(id, pan) {
    state.mapSel = id || null;
    mapSets.forEach((entry) => {
      entry.markers.forEach((m, mid) => {
        const el = m.getElement && m.getElement();
        const pin = el && el.querySelector('.lp-pin');
        if (pin) pin.classList.toggle('on', mid === state.mapSel);
      });
      if (pan && state.mapSel) {
        const m = entry.markers.get(state.mapSel);
        if (m) entry.map.panTo(m.getLatLng());
      }
    });
    root.querySelectorAll('.map-order li').forEach((li) => li.classList.toggle('on', li.dataset.id === state.mapSel));
    const sel = root.querySelector('#mapSel');
    if (sel) {
      const li = state.mapSel ? root.querySelector(`.map-order li[data-id="${CSS.escape(state.mapSel)}"]`) : null;
      sel.textContent = li ? `${li.querySelector('.map-name').textContent}　${li.querySelector('small').textContent}` : '店のピンを押すと、ここに店名が出ます';
    }
    renderFullBar();
  }

  // 全画面の地図（指で動かして、拡大縮小。下の一覧と同じ番号・同じ店）
  // 開くときは、提案の地図を外す（二重に出ないように）。閉じたら、提案の地図をまた出す
  let fullOpening = false;
  function openFullMap() {
    if (fullMap || fullOpening) return;     // 連打しても、一度だけ開く
    const list = visibleList();
    if (!list.length) return;
    fullOpening = true;                     // 読み込みを待つ間も、二回目は弾く
    dropInline();
    ensureLeafletCss();
    loadLeaflet().then(() => {
      if (fullMap) return;
      dropInline();
      const wrap = document.createElement('div');
      wrap.className = 'mapfull';
      wrap.setAttribute('role', 'dialog');
      wrap.setAttribute('aria-modal', 'true');
      wrap.setAttribute('aria-label', '地図（全画面）');
      wrap.innerHTML = `<div class="mapfull-map" id="mapFullBox"></div>
        <div class="mapfull-top"><span class="mapfull-title">店の位置</span><button type="button" class="mapfull-x" aria-label="閉じる">${ic('x')}</button></div>
        <p class="mapfull-hint">ピンを押すと、その店の情報が下に出ます</p>
        <div class="mapfull-bar" id="mapFullBar" hidden></div>`;
      root.appendChild(wrap);
      const entry = buildMap(wrap.querySelector('#mapFullBox'), list);
      fullMap = { wrap, entry, list };
      root.host.classList.add('mapfull-open');
      wrap.querySelector('.mapfull-x').addEventListener('click', closeFullMap);
      wrap.querySelector('#mapFullBar').addEventListener('click', (e) => {
        if (e.target.closest('[data-fb="detail"]') && state.mapSel) openShopSheet(state.mapSel);
      });
      document.addEventListener('keydown', fullKey);
      setTimeout(() => { if (fullMap && fullMap.entry === entry) entry.map.invalidateSize(); }, 60);   // 開いた直後の大きさを合わせる
      selectShop(state.mapSel, false);
    }).catch((e) => toast(e.message)).finally(() => { fullOpening = false; });
  }
  function fullKey(e) { if (e.key === 'Escape') closeFullMap(); }
  function closeFullMap() {
    if (!fullMap) return;
    dropMap(fullMap.entry);
    fullMap.wrap.remove();
    document.removeEventListener('keydown', fullKey);
    root.host.classList.remove('mapfull-open');
    fullMap = null;
    if (!$('#sheet').hidden) closeSheet();
    if (state.pView === 'map' && $('#mapBox')) mountMap(visibleList());   // 提案の地図を、もう一度出す
  }

  // 全画面の下のバー：選んだ店の番号・店名・業種・住所・距離・当日の営業時間（定休日・不明も分かるように）
  function hoursLine(s) {
    if (!hasHoursData(s)) return '営業時間は不明';
    const t = (s.hours || {})[weekKey(state.date)];
    return t ? `${fmtDate(state.date)}　${esc(t)}` : `${fmtDate(state.date)}は定休日`;
  }
  function renderFullBar() {
    if (!fullMap) return;
    const bar = fullMap.wrap.querySelector('#mapFullBar');
    const idx = fullMap.list.findIndex((x) => x.id === state.mapSel);
    fullMap.wrap.classList.toggle('has-sel', idx >= 0);
    if (idx < 0) { bar.hidden = true; bar.innerHTML = ''; return; }
    const s = fullMap.list[idx];
    bar.hidden = false;
    bar.innerHTML = `<div class="fb-top"><span class="pin-no${pinClass(idx)}">${pinLabel(idx)}</span><span class="fb-name">${esc(s.name)}</span><span class="fb-dist">${state.pSort === 'route' ? '前から ' : ''}${legText(s)}</span></div>
      <div class="fb-row"><span class="tag">${esc(s.industry) || '業種は不明'}</span><span class="fb-addr">${esc(s.address)}</span></div>
      <p class="fb-hours">${hoursLine(s)}</p>
      <button type="button" class="btn small" data-fb="detail">詳しく見る</button>`;
  }

  // 店の詳細（既存の openSheet を使う）：電話・サイト・Instagram・訪問の状態・訪問予定に追加・Map URLコピー・訪問NG
  function openShopSheet(id) {
    const s = visibleList().find((x) => x.id === id) || findShop(id);   // 一覧の中の店（ルート順の区間距離も入っている）
    if (!s) return;
    const links = [
      has(s.phone) ? `<a class="pill-btn" href="tel:${esc(s.phone)}">電話 ${esc(s.phone)}</a>` : '',
      has(s.website) && /^https?:\/\//.test(s.website) ? `<a class="pill-btn" href="${esc(s.website)}" target="_blank" rel="noopener">サイトを見る</a>` : '',
      has(s.insta) ? `<a class="pill-btn" href="https://www.instagram.com/${esc(s.insta)}" target="_blank" rel="noopener">${ic('insta')}@${esc(s.insta)}</a>` : '',
    ].filter(Boolean).join('');
    const status = s.visited ? '訪問済みの店です' : inVisit(id) ? '訪問予定に入っています' : inLater(id) ? '後で訪問に入っています' : '';
    openSheet(s.name, `
      <p class="sub">${esc(s.industry) || '業種は不明'}　${esc(s.address)}</p>
      <p class="sub">${state.pSort === 'route' ? '前から ' : ''}${legText(s)}　${hoursLine(s)}</p>
      ${status ? `<div class="banner">${ic('info')}${status}</div>` : ''}
      ${links ? `<div class="meta-row">${links}</div>` : ''}
      <div class="actions">
        <button class="btn" data-act="add" data-id="${esc(id)}" ${inVisit(id) ? 'disabled' : ''}>${ic('plus')}${inVisit(id) ? '追加済み' : '訪問予定に追加'}</button>
        <button class="btn" data-act="copy-map" data-id="${esc(id)}">${ic('copy')}Map URLコピー</button>
        <button class="btn text" data-act="block" data-id="${esc(id)}">${ic('block')}訪問NG</button>
      </div>`);
  }

  // ---------- 固定ヘッダーのメニュー ----------
  // メニューは完了報告アプリの三本線メニュー（右上）に出す。その中の「訪問NG一覧」は
  // 下の mlActions から呼ばれる。ここでは何もしない（旧・この画面の中のメニューは使わない）
  function closeMenu() {}

  // 下のタブの出し入れ（ゆっくり隠れる・少し上に動かすと出る）は、完了報告アプリ側（app.js）が両方のモードで行う

  // ---------- 操作の登録（クリックの委任） ----------
  const ACT = {
    login: () => login(),
    logout: () => logout(),
    'area-mode': (el) => { state.area.mode = el.dataset.v; renderArea(); },
    gps: () => locate(() => renderArea()),
    radius: (el) => { state.radius = el.dataset.v; renderRadius(); },
    'search-date': (el) => { state.date = el.dataset.date; CAL_OPEN.search = false; renderDate(); }, // 選んだら閉じる
    'cal-toggle': (el) => {
      const kind = el.dataset.kind;
      CAL_OPEN[kind] = !CAL_OPEN[kind];
      if (kind === 'search') renderDate(); else renderDateSheet();
    },
    'cal-nav': (el) => {
      const kind = el.dataset.kind;
      CAL[kind] = shiftMonth(CAL[kind], Number(el.dataset.d));
      if (kind === 'search') renderDate(); else renderDateSheet();
    },
    'menu-close': () => closeMenu(),
    'go-dc': () => { if (window.dcSwitchApp) window.dcSwitchApp('dc'); }, // 完了報告の画面に戻る（同じ画面の中で切り替える）
    'menu-block': () => { closeMenu(); openBlockList(); },
    'login-from-sheet': () => { closeSheet(); login(); },
    'menu-logout': () => { closeMenu(); logout(); },
    'menu-login': () => { closeMenu(); login(); },
    // 「地図で見る」はルート順、「一覧で見る」はおすすめ順が初めの並び（並べ替えのボタンで変えられる）
    'p-view': (el) => { state.pView = el.dataset.v; state.pSort = state.pView === 'map' ? 'route' : 'rec'; saveUiSoon(); renderProposal(); },
    'map-full': () => openFullMap(),
    'map-pick': (el) => selectShop(el.dataset.id, true),
    cat: (el) => { if (CATS.some(([k]) => k === el.dataset.v)) { state.category = el.dataset.v; renderInd(); } },
    'more-results': () => loadMore(),
    'block-list': openBlockList,
    'run-search': runSearch,
    'go-search': () => go('search'),
    'go-list': () => go('list'),
    'p-sort': (el) => { state.pSort = el.dataset.v; renderProposal(); },
    'p-ind': (el) => { const n = el.dataset.name; state.pIndustries.has(n) ? state.pIndustries.delete(n) : state.pIndustries.add(n); renderProposal(); },
    'open-only': () => { state.openOnly = !state.openOnly; renderProposal(); },
    'p-expand': (el) => {
      const id = el.dataset.id, k = el.dataset.k;
      const key = id + ':' + k;
      if (k === 'overall') {
        state.expanded.has(key) ? state.expanded.delete(key) : state.expanded.add(key);
      } else {
        // 内訳は1つだけ開く：別の項目を押したら、今開いている方は閉じる
        const wasOpen = state.expanded.has(key);
        KEYS.forEach((x) => state.expanded.delete(id + ':' + x));
        if (!wasOpen) state.expanded.add(key);
      }
      renderProposal();
    },
    add: (el) => addVisit(el.dataset.id),
    'copy-map': (el) => { const s = findShop(el.dataset.id); if (s) copyText(mapUrl(s), 'Map URLをコピーしました'); },
    block: (el) => openBlockSheet(el.dataset.id),
    'block-reason': (el) => doBlock(el.dataset.id, el.dataset.r),
    unblock: (el) => unblock(el.dataset.id),
    'later-move': (el) => moveList(el.dataset.id, 'visit', 'later'),
    'back-visit': (el) => moveList(el.dataset.id, 'later', 'visit'),
    remove: (el) => removeFrom(el.dataset.id, el.dataset.src),
    'copy-all': (el) => copyAll(el.dataset.src),
    'sort-dist': sortByDistance,
    'pick-date': (el) => openDatePick(el.dataset.id, el.dataset.kind),
    dpick: (el) => { if (dateCb) dateCb(el.dataset.date); closeSheet(); },
    'dpick-none': (el) => { setVisitDate(el.dataset.id, null, el.dataset.kind); closeSheet(); },
  };

  // クリックは、この画面（shadow root）の中だけで受ける。下のタブ（data-nav）も、ここで画面を切り替える
  root.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { e.preventDefault(); go(nav.dataset.nav); return; }
    if (e.target.closest('[data-close]')) { closeSheet(); return; }
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = ACT[el.dataset.act];
    if (fn) fn(el);
  });

  root.addEventListener('input', (e) => {
    if (e.target.id === 'addr') state.area.address = e.target.value;
  });

  // ---------- 起動 ----------
  // 完了報告アプリの訪問リストが変わったら、この画面も読み直す（同じデータを見る）
  function visitsChanged() {
    syncVisits();
    renderAll();
  }
  async function init() {
    renderNav();
    const note = $('#demoNote');
    if (note) note.hidden = !D.isSample;
    const restored = restoreUi();
    // 再読み込みしても、保存した現在地の位置と住所が戻る（住所が取れていなかったときは、もう一度取る）
    if (state.area.lat != null) {
      state.userPos = { lat: state.area.lat, lng: state.area.lng };
      if (state.area.place == null) setTimeout(resolvePlace, 0);
    }
    syncVisits();
    renderAll();
    showScreen();
    // 操作のたびに、条件・候補・表示の状態を端末に保存する（再読み込みしても戻る）
    ['input', 'change', 'click'].forEach((ev) => root.addEventListener(ev, saveUiSoon));
    // 業種の一覧を開いた・閉じたときも覚える（toggle は泡立たないので、捕まえる段階で受ける）
    root.addEventListener('toggle', (e) => {
      if (e.target && e.target.id === 'pIndFold') { state.pIndOpen = e.target.open; saveUiSoon(); }
    }, true);
    if (restored === 'stale') toast('前の日の提案は消しました。もう一度検索してください');
    D.onVisitsChange(visitsChanged);
    D.onAuthChange(() => refreshUser());
    // 完了報告アプリの三本線メニューから呼ぶ（訪問NG一覧）
    window.mlActions = {
      blockList: () => openBlockList(),
      // 完了報告アプリの上のバーから、提案リストの並び順を変える
      sort: (v) => { if (Object.prototype.hasOwnProperty.call(SORTERS, v)) { state.pSort = v; saveUiSoon(); renderProposal(); } },
      go: (name) => go(name), // 下のタブ（完了報告アプリの棒）から画面を切り替える
    };
    await refreshUser(); // 画面は先に出し、ログイン状態は後から反映する
  }
  init();
})();
