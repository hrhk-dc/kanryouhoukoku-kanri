/*
 * maplist-app：データの受け口（VLA_DATA）
 *
 * 画面（app.js）はこの VLA_DATA の関数だけを呼ぶ。
 *  - 店舗検索：サーバー（/api/ml-search）が OpenStreetMap の店データを返す（評価・口コミ・価格帯は無い）。住所の座標変換は /api/ml-geocode。
 *    APIキーはサーバーの環境変数 GOOGLE_MAPS_API_KEY にあり、ブラウザには出ない。
 *  - 訪問NG：完了報告アプリと同じ Firebase（dc-report-8e1d1）の vla_blocks に保存する。
 *  - ログインは完了報告アプリと同じ Googleログイン。許可は settings/members（メンバーだけ）。
 */
(function () {
  'use strict';

  // 業種：8グループ・33件（この並びと名前を正とする。サーバーの検索語もこの名前から作る）
  const GROUPS = [
    { name: '飲食店', items: ['寿司・割烹', '焼き鳥・やきとん', 'ラーメン・中華そば', '居酒屋・大衆酒場', 'カフェ・喫茶', '焼肉・ホルモン', 'そば・うどん', 'パン・洋菓子・和菓子', 'イタリアン・フレンチ・ビストロ', '中華・餃子', '定食・食堂・とんかつ・洋食', 'バー・スナック'] },
    { name: '美容院', items: ['美容室（ヘア）', '理容室・バーバー', 'ネイル・まつげ', 'エステ・脱毛'] },
    { name: 'アパレル', items: ['セレクト・婦人服', '古着', '呉服・着物', '靴・バッグ・小物'] },
    { name: '整体・整骨院', items: ['整骨院・接骨院', '整体・カイロ', '鍼灸', 'リラクゼーション'] },
    { name: '不動産', items: ['賃貸仲介', '売買・買取'] },
    { name: '建築・土木', items: ['工務店・注文住宅・リフォーム', '外壁・屋根塗装', '水道・電気・設備', '外構・造園', '土木・解体'] },
    { name: '教室・スクール', items: ['学習塾（個別指導・小中高）'] },
    { name: 'その他', items: ['汎用（例：クリーニング）'] },
  ];
  const ALL_ITEMS = GROUPS.flatMap((g) => g.items);

  const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const BLOCKS = 'vla_blocks';
  const LOCAL_BLOCKS = 'vla:blocks'; // 以前の端末内データ（一度だけ取り込む）

  function haversine(a, b) {
    const R = 6371000, rad = (x) => (x * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // ---------- Firebase（完了報告アプリと同じプロジェクト・Googleログイン） ----------
  // 完了報告アプリの画面と同じ Firebase（同じログイン・同じ Firestore）を使う。二重に初期化しない
  let fbPromise = null;
  function firebase() {
    if (!fbPromise) {
      fbPromise = (async () => {
        const { firebaseConfig } = await import('../firebase-config.js');
        const [appM, authM, fsM] = await Promise.all([
          import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js'),
        ]);
        const app = appM.getApps().length ? appM.getApp() : appM.initializeApp(firebaseConfig);
        return { authM, fsM, auth: authM.getAuth(app), db: fsM.getFirestore(app) };
      })();
    }
    return fbPromise;
  }

  // ログインの状態が決まるまで待ってから、今の利用者を返す（ログインしていなければ null）
  async function currentUser() {
    const f = await firebase();
    if (f.auth.currentUser) return f.auth.currentUser;
    return new Promise((resolve) => {
      const off = f.authM.onAuthStateChanged(f.auth, (u) => { off(); resolve(u); });
    });
  }

  async function signIn() {
    const f = await firebase();
    const provider = new f.authM.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await f.authM.signInWithPopup(f.auth, provider);
    } catch (e) {
      if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) {
        await f.authM.signInWithRedirect(f.auth, provider);
        return null;
      }
      throw e;
    }
    return f.auth.currentUser;
  }

  async function signOut() {
    const f = await firebase();
    await f.authM.signOut(f.auth);
  }

  // サーバーへの通信（ログイン不要。サーバー側でIPごとの回数制限をかけている）
  // ログインしていれば、トークンを付ける（付けなくても検索できる）
  async function api(path, body) {
    const u = await currentUser();
    const headers = { 'Content-Type': 'application/json' };
    if (u) headers.Authorization = 'Bearer ' + (await u.getIdToken());
    let res;
    try {
      res = await fetch(path, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new Error('通信できませんでした。電波の良いところでもう一度お試しください');
    }
    let j = {};
    try { j = await res.json(); } catch (e) { /* 空の応答 */ }
    if (!res.ok || !j.ok) throw new Error(j.error || '取得に失敗しました。時間をおいてもう一度お試しください');
    return j;
  }

  // ---------- 訪問NG（vla_blocks） ----------
  // ログイン中：Firestore（vla_blocks）。未ログイン：この端末の中だけに保存する
  const blockOf = (d) => ({ id: d.id, name: d.name || '', reason: d.reason || '', at: d.at || 0 });

  function localBlocks() {
    try { const v = JSON.parse(localStorage.getItem(LOCAL_BLOCKS) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function saveLocalBlocks(list) {
    try { localStorage.setItem(LOCAL_BLOCKS, JSON.stringify(list)); } catch (e) { /* 保存できない端末では無視 */ }
    return list;
  }

  // 以前の端末内データを一度だけ Firestore に移す
  async function migrateLocal(f, u) {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(LOCAL_BLOCKS) || '[]'); } catch (e) { return; }
    if (!Array.isArray(list) || !list.length) return;
    for (const b of list) {
      await f.fsM.setDoc(f.fsM.doc(f.db, BLOCKS, String(b.id)), {
        name: b.name || '', reason: b.reason || '', at: b.at || Date.now(),
        createdBy: u.uid, createdByName: u.displayName || '',
      });
    }
    try { localStorage.removeItem(LOCAL_BLOCKS); } catch (e) { /* 無視 */ }
  }

  async function listBlocks() {
    const f = await firebase();
    const u = await currentUser();
    if (!u) return localBlocks(); // 未ログインは、この端末の中の一覧
    await migrateLocal(f, u);
    const snap = await f.fsM.getDocs(f.fsM.collection(f.db, BLOCKS));
    return snap.docs.map((d) => blockOf({ id: d.id, ...d.data() }));
  }

  // ---------- 公開する関数 ----------
  window.VLA_DATA = {
    GROUPS,
    isSample: false, // 本番のデータ（OpenStreetMap）

    // 店舗の候補を返す（近い順）。店の情報は name・lat/lng・address・industry・hours・phone/website/insta（ある場合だけ）
    //  center: {lat,lng}, radius: m, town: 町名まるごとか, viewport: 町名の範囲, industries: 業種名の配列（空＝全業種）
    // category: 'food'（飲食店）／'other'（飲食店以外）／'all'（両方）。page: 1から（1ページ20件）
    // 返す：{ shops（近い順）, hasMore（次のページがあるか） }
    async searchShops({ center, radius, town = false, viewport = null, category = 'all', page = 1 }) {
      const j = await api('/api/ml-search', { center, radius, town, viewport, category, page });
      const shops = (j.shops || [])
        .map((s) => ({ ...s, distance: haversine(center, s) }))
        .filter((s) => town || s.distance <= radius)  // 町名まるごとは範囲（矩形）で絞っている
        .filter((s) => !s.website && !s.brand)        // 絶対条件（二重の確認）：サイトのある店・チェーン店は、画面に出さない
        .sort((a, b) => a.distance - b.distance);
      return { shops, hasMore: j.hasMore === true };
    },

    // 住所・町名 → 座標（範囲も返す）。見つからなければ null
    async geocode(address) {
      const j = await api('/api/ml-geocode', { q: address });
      return { lat: j.lat, lng: j.lng, label: j.label, viewport: j.viewport || null };
    },

    // 現在地 → 付近の地名（「○○県○○市○○町」）。取れなければ例外（画面は元の文のまま）
    async placeName({ lat, lng }) {
      const j = await api('/api/ml-geocode', { reverse: { lat, lng } });
      return j.label || null;
    },

    // 訪問NG。ログイン中は Firebase（完了報告アプリと同じ）、未ログインはこの端末の中だけ
    async getBlocks() {
      return listBlocks();
    },
    async addBlock(block) {
      const f = await firebase();
      const u = await currentUser();
      if (!u) {
        const list = localBlocks().filter((b) => String(b.id) !== String(block.id));
        list.push({ id: String(block.id), name: block.name || '', reason: block.reason || '', at: block.at || Date.now() });
        return saveLocalBlocks(list);
      }
      await f.fsM.setDoc(f.fsM.doc(f.db, BLOCKS, String(block.id)), {
        name: block.name || '', reason: block.reason || '', at: block.at || Date.now(),
        createdBy: u.uid, createdByName: u.displayName || '',
      });
      return listBlocks();
    },
    async removeBlock(id) {
      const f = await firebase();
      const u = await currentUser();
      if (!u) return saveLocalBlocks(localBlocks().filter((b) => String(b.id) !== String(id)));
      await f.fsM.deleteDoc(f.fsM.doc(f.db, BLOCKS, String(id)));
      return listBlocks();
    },

    // 提案の地図画像（PNG）。店の位置を番号つきのピンで並べたもの。APIキーはサーバーの中だけ
    // view を渡すと、その中心と拡大で取り直す（画像ビューアで拡大したとき）。省くと店の位置に合わせて自動
    async mapImage(points, view) {
      const u = await currentUser();
      const headers = { 'Content-Type': 'application/json' };
      if (u) headers.Authorization = 'Bearer ' + (await u.getIdToken());
      let res;
      try {
        res = await fetch('/api/ml-map', {
          method: 'POST',
          headers,
          body: JSON.stringify(view ? { points, center: view.center, zoom: view.zoom } : { points }),
        });
      } catch (e) {
        throw new Error('通信できませんでした。電波の良いところでもう一度お試しください');
      }
      if (!res.ok) {
        let j = {};
        try { j = await res.json(); } catch (e) { /* 空の応答 */ }
        throw new Error(j.error || '地図を取得できませんでした');
      }
      return res.blob();
    },

    // 訪問リスト：完了報告アプリの「訪問リスト（visits）」そのもの。別のデータは持たない。
    // 実体は完了報告アプリの画面の処理（app.js の window.dcVisitBridge）。ここは窓口だけ
    visits: {
      list: () => (window.dcVisitBridge ? window.dcVisitBridge.list() : []),
      // 後で訪問も visits の中（ml_later の印）。完了報告の画面には出ない
      laterList: () => (window.dcVisitBridge ? window.dcVisitBridge.laterList() : []),
      add: (shop, visitDate) => window.dcVisitBridge.add(shop, visitDate),
      setLater: (id, on) => window.dcVisitBridge.setLater(id, on),
      setDate: (id, visitDate) => window.dcVisitBridge.setDate(id, visitDate),
      remove: (id) => window.dcVisitBridge.remove(id),
    },
    onVisitsChange: (cb) => window.addEventListener('dc-visits-changed', cb),
    onAuthChange: (cb) => window.addEventListener('dc-auth-changed', cb),

    // ログイン（画面のボタンから呼ぶ）
    signIn,
    signOut,
    currentUser: async () => (await currentUser()) || null,
  };
})();
