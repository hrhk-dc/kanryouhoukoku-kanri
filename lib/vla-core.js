// maplist-app：サーバー側の共通処理（Cloudflare Pages Functions から使う）
//  - Google Places API (New) で店舗を探す（ウェブサイトなし・チェーン除外）
//  - 純粋な関数（チェーン判定・店データへの変換）はテストできるように分けてある
//
// キーは Cloudflare の環境変数 GOOGLE_MAPS_API_KEY から読む（コードには書かない）。

export const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const DAY_JP = ["日", "月", "火", "水", "木", "金", "土"];
export const PLACES_CAP = 50; // 1回の検索で返す上限（画面の仕様と合わせる）

// ---------- 業種 → 検索語 ----------
// 業種の名前（GROUPS の items と同じ文字列）から、Places の検索語を作る
export function industryQuery(name) {
  if (name.startsWith("汎用")) return "クリーニング"; // 汎用の見本（例：クリーニング）
  return name.replace(/（.*?）/g, "").replace(/[・]/g, " ").trim();
}

// ---------- チェーン判定 ----------
// Places にはチェーンの情報が無いため、店名で判定する。
//  1. 既知のチェーン名（CHAIN_NAMES）に含まれる → チェーン
//  2. 店名から支店・号店などを除いた「ブランド名」が、検索結果の中に2件以上 → チェーン
// 名前だけで確実に分かるチェーン（一般名詞は入れない。独立店を除外しないため）。人が追加する
const CHAIN_NAMES = [
  "マクドナルド", "スターバックス", "ドトール", "コメダ珈琲", "吉野家", "すき家", "松屋", "ガスト", "サイゼリヤ",
  "ワタミ", "はなまる", "丸亀製麺", "くら寿司", "スシロー", "かっぱ寿司", "QBハウス", "ダイソー",
  "ファミリーマート", "ローソン", "ミニストップ", "ウェルシア", "マツモトキヨシ", "オートバックス", "ケーズデンキ",
  "ニトリ", "しまむら", "ユニクロ", "ジーユー", "ブックオフ", "セカンドストリート", "ハードオフ",
  "ティップネス", "ゴールドジム", "カーブス", "明光義塾", "個別教室のトライ", "東京個別指導学院", "ITTO個別指導塾",
  "ミスタードーナツ", "モスバーガー", "ケンタッキー", "バーガーキング", "一蘭", "幸楽苑", "リンガーハット",
  "大戸屋", "和食さと", "バーミヤン", "ココス", "ロイヤルホスト", "デニーズ", "ジョナサン", "ダスキン", "おそうじ本舗",
  "セブン-イレブン", "セブンイレブン", "デイリーヤマザキ", "ドン・キホーテ", "イオン", "ヤマダ電機", "ビックカメラ", "ヨドバシカメラ",
  "無印良品", "養老の滝", "鳥貴族", "白木屋", "和民", "日高屋", "餃子の王将", "ロッテリア", "フレッシュネスバーガー",
  "築地銀だこ", "天下一品", "一風堂", "コメリ", "カインズ", "コーナン", "ケンタッキーフライドチキン",
];

// 店名 → ブランド名（支店・号店・番地などを除く）
export function brandKey(name) {
  let n = String(name || "").replace(/[\s　]/g, "");
  n = n.replace(/[（(].*?[）)]/g, "");
  n = n.replace(/(本店|支店|店舗|店|[0-9０-９一二三四五六七八九十]+号店|[0-9０-９]+号館|東口|西口|南口|北口|駅前|[0-9０-９]+丁目)+$/, "");
  return n;
}

// チェーンかどうかを判定する。raw は検索で取れた全部の店（サイトありの店も含める）
const nameOf = (p) => p.displayName?.text ?? p.name ?? "";

export function chainIds(all) {
  // 同じ店が重複して返ってきても1件として数える
  const raw = [...new Map(all.filter((p) => p.id).map((p) => [p.id, p])).values()];
  const counts = new Map();
  for (const p of raw) {
    const k = brandKey(nameOf(p));
    if (k) counts.set(k, (counts.get(k) || 0) + 1);
  }
  const ids = new Set();
  for (const p of raw) {
    const k = brandKey(nameOf(p));
    const known = CHAIN_NAMES.some((c) => nameOf(p).includes(c));
    if (known || (k && counts.get(k) >= 2)) ids.add(p.id);
  }
  return ids;
}

// ---------- 営業時間 ----------
// Places の weekdayDescriptions（例：「月曜日: 11:30～14:00」）を曜日ごとの文字にする。定休は null
export function parseHours(descs) {
  const hours = {};
  const names = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];
  if (!descs || !descs.length) {
    DAYS.forEach((d) => (hours[d] = "時間不明"));
    return hours;
  }
  DAYS.forEach((d, i) => {
    const line = descs.find((t) => t.startsWith(names[i])) || "";
    const text = line.replace(/^[^:：]*[:：]\s*/, "").trim();
    hours[d] = !text || /休|closed/i.test(text) ? null : text;
  });
  return hours;
}

// ---------- Places の結果 → 店データ ----------
// 返す形は public/data.js の SAMPLE と同じ（app.js がそのまま使う）
export function toShop(p, industry) {
  const addr = String(p.formattedAddress || "").replace(/^日本、?\s*/, "").replace(/^〒\d{3}-\d{4}\s*/, "");
  return {
    id: p.id,
    name: p.displayName?.text || "",
    industry,
    address: addr,
    lat: p.location?.latitude,
    lng: p.location?.longitude,
    rating: p.rating ?? 0,          // 評価が無い店は0（点数は1点）
    reviews: p.userRatingCount ?? 0,
    priceLevel: p.priceLevel ?? null, // 価格帯（PRICE_LEVEL_…）。無い店は null（点数の平均から外す）
    opened: null,                   // Places には開業年が無い（今は点数に使わない）
    staff: null,                    // Places には従業員数が無い（今は点数に使わない）
    insta: "",
    hours: parseHours(p.regularOpeningHours?.weekdayDescriptions),
    visited: false,
  };
}

// ウェブサイトなし・営業中・チェーンでない店だけを残す
export function filterPlaces(raw) {
  const chains = chainIds(raw);
  const seen = new Set();
  const out = [];
  for (const p of raw) {
    if (!p.id || seen.has(p.id)) continue;
    seen.add(p.id);
    if (p.websiteUri) continue;                                  // ウェブサイトがある店は対象外
    if (p.businessStatus && p.businessStatus !== "OPERATIONAL") continue; // 閉業・休業など
    if (chains.has(p.id)) continue;                              // チェーン店は対象外
    out.push(p);
  }
  return out;
}

// ---------- Places API (New) ----------
const PLACES = "https://places.googleapis.com/v1/places:searchText";
export const SEARCH_FIELDS = [
  "places.id", "places.displayName", "places.formattedAddress", "places.location",
  "places.rating", "places.userRatingCount", "places.websiteUri", "places.businessStatus",
  "places.regularOpeningHours.weekdayDescriptions", "places.priceLevel",
].join(",");

export function keyOf(env) {
  return String(env.GOOGLE_MAPS_API_KEY || "").trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
}

// 1回の検索（業種ごと）。1ページ最大20件
export async function placesText(key, body) {
  const r = await fetch(PLACES, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": SEARCH_FIELDS },
    body: JSON.stringify({ languageCode: "ja", regionCode: "JP", pageSize: 20, ...body }),
  });
  const j = await r.json();
  if (!r.ok) {
    const reason = j?.error?.details?.find((d) => d.reason)?.reason || j?.error?.status || "";
    const err = new Error(j?.error?.message || `Places API ${r.status}`);
    err.reason = reason;
    err.status = r.status;
    err.detail = j?.error?.message || "";
    throw err;
  }
  return j.places || [];
}

// 住所・町名 → 座標（と範囲）。Places の検索で1件だけ取る
export async function geocodeText(key, q) {
  const r = await fetch(PLACES, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "places.location,places.viewport,places.formattedAddress" },
    body: JSON.stringify({ textQuery: q, languageCode: "ja", regionCode: "JP", pageSize: 1 }),
  });
  const j = await r.json();
  if (!r.ok) {
    // searchText と同じく、Google の理由（reason）と HTTP の状態を付ける
    const reason = j?.error?.details?.find((d) => d.reason)?.reason || j?.error?.status || "";
    throw Object.assign(new Error(j?.error?.message || `Places API ${r.status}`), { reason, status: r.status, detail: j?.error?.message || "" });
  }
  const p = (j.places || [])[0];
  if (!p?.location) return null;
  const vp = p.viewport;
  const ok = vp && vp.low && vp.high;
  return {
    lat: p.location.latitude,
    lng: p.location.longitude,
    label: p.formattedAddress || q,
    viewport: ok ? { south: vp.low.latitude, west: vp.low.longitude, north: vp.high.latitude, east: vp.high.longitude } : null,
  };
}

// 座標 → 付近の地名（町名まで）。既存の検索（searchText）と同じ課金・同じキーで、座標の近くの場所を1件だけ取り、
// 住所から番地を落として「○○県○○市○○町」の形にする。取れなければ null（画面は座標を出さず、元の文のまま）
export async function reverseText(key, lat, lng) {
  // 座標そのものを検索語にすると、Places の検索は場所が見つからない（「取れませんでした」になっていた）。
  // 座標の近く（半径500m）の場所を、検索語「店」で探し、その住所を使う（同じ検索・同じ項目・同じキー）
  const r = await fetch(PLACES, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "places.formattedAddress" },
    body: JSON.stringify({
      textQuery: "店", languageCode: "ja", regionCode: "JP", pageSize: 1,
      locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 500 } },
    }),
  });
  const j = await r.json();
  if (!r.ok) {
    const reason = j?.error?.details?.find((d) => d.reason)?.reason || j?.error?.status || "";
    throw Object.assign(new Error(j?.error?.message || `Places API ${r.status}`), { reason, status: r.status });
  }
  const addr = (j.places || [])[0]?.formattedAddress;
  if (!addr) return null;
  const town = String(addr).replace(/^日本[、,]?\s*/, "").replace(/^〒?\s*\d{3}-?\d{4}\s*/, "").split(/[0-9０-９]/)[0].replace(/[丁目番地号\-－ー\s]+$/, "").trim();
  return town || null;
}

// Google の理由（reason）→ 画面に出す日本語のヒント（管理者が直せる内容）
export function placesHint(reason) {
  return {
    API_KEY_INVALID: "APIキーが正しくありません（管理者に確認してください）",
    SERVICE_DISABLED: "Places API (New) が有効になっていません",
    BILLING_DISABLED: "請求先アカウントが有効になっていません",
    REQUEST_DENIED: "APIの利用が許可されていません",
    API_KEY_HTTP_REFERRER_BLOCKED: "APIキーに「HTTPリファラー（サイト）の制限」がかかっています。Google Cloudの「API キー」の「アプリケーションの制限」を「なし」にしてください",
    API_KEY_IP_ADDRESS_BLOCKED: "APIキーに「IPアドレスの制限」がかかっています。Google Cloudの「API キー」の制限を「なし」にしてください",
    API_KEY_SERVICE_BLOCKED: "APIキーで、このAPI（Places API (New) など）が許可されていません。Google Cloudの「API の制限」に追加してください",
  }[reason] || "";
}

// 画面に出す文。知っている理由は日本語のヒント。知らない理由は、Google の理由と状態を付ける（キーは出さない）
export function placesErrorText(e, key, fallback) {
  const hint = placesHint(e?.reason);
  if (hint) return hint;
  const why = [e?.reason, e?.status ? `HTTP ${e.status}` : ""].filter(Boolean).join(" ");
  const detail = String(e?.detail || "").split(key || "\u0000").join("[キー]").slice(0, 160);
  if (!why && !detail) return fallback;
  return `${fallback}（Googleの理由：${why || "不明"}${detail ? "。" + detail : ""}）`;
}

// 業種ごとに検索して、店の候補（まだ絞り込み前）を集める。同時に5件まで
export async function searchAll(key, { center, radius, town, viewport, industries }) {
  const bodyFor = (q) => {
    if (town && viewport) {
      // 町名まるごと：町名の範囲（矩形）の中だけ
      return { textQuery: q, locationRestriction: { rectangle: {
        low: { latitude: viewport.south, longitude: viewport.west },
        high: { latitude: viewport.north, longitude: viewport.east },
      } } };
    }
    // それ以外：中心から半径（円）の付近を優先。距離の絞り込みは data.js 側で行う
    return { textQuery: q, locationBias: { circle: { center: { latitude: center.lat, longitude: center.lng }, radius: Math.min(radius, 50000) } } };
  };
  const queries = industries.map((n) => ({ industry: n, body: bodyFor(industryQuery(n)) }));
  const raw = [];
  const byId = new Map();
  for (let i = 0; i < queries.length; i += 5) {
    const batch = queries.slice(i, i + 5);
    const results = await Promise.all(batch.map(async (q) => {
      const places = await placesText(key, q.body);
      return places.map((p) => ({ p, industry: q.industry }));
    }));
    for (const list of results) for (const { p, industry } of list) {
      raw.push(p);
      if (!byId.has(p.id)) byId.set(p.id, industry);
    }
  }
  return { raw, industryOf: byId };
}

// 検索結果 → 画面用の店データ（絞り込み・チェーン除外・業種の付与）
export function buildShops(raw, industryOf) {
  return filterPlaces(raw)
    .map((p) => toShop(p, industryOf.get(p.id) || ""))
    .filter((s) => s.lat != null && s.lng != null);
}
