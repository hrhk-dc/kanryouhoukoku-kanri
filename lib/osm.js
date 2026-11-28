// OpenStreetMap（Overpass API）から店舗を取る。Google は呼ばない（完全無料・OSM のデータ）
//  - 店舗系のタグ（amenity・shop・healthcare・office・craft）を、中心＋半径（または町名の範囲）で取る
//  - タグから、今の33業種のラベルに寄せる。食べ物（food）か、それ以外（other）かも決める
//  - 営業時間（opening_hours）は曜日ごとの形にする。変換できないものは「時間不明」として残す（落とさない）
//  - 評価・口コミ数・価格帯は返さない
//  - 利用：Overpass の公開サーバー（利用の目安を守るため、同じ条件は当日キャッシュする）

export const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const UA = "dc-maplist/1.0 (kanryohkk-app)";

// 業種の分け方（画面の GROUPS と同じ。変えるときは両方）
export const FOOD_ITEMS = [
  "寿司・割烹", "焼き鳥・やきとん", "ラーメン・中華そば", "居酒屋・大衆酒場", "カフェ・喫茶", "焼肉・ホルモン",
  "そば・うどん", "パン・洋菓子・和菓子", "イタリアン・フレンチ・ビストロ", "中華・餃子", "定食・食堂・とんかつ・洋食", "バー・スナック",
];
export const INDUSTRY_ITEMS = [
  ...FOOD_ITEMS,
  "美容室（ヘア）", "理容室・バーバー", "ネイル・まつげ", "エステ・脱毛",
  "セレクト・婦人服", "古着", "呉服・着物", "靴・バッグ・小物",
  "整骨院・接骨院", "整体・カイロ", "鍼灸", "リラクゼーション",
  "賃貸仲介", "売買・買取",
  "工務店・注文住宅・リフォーム", "外壁・屋根塗装", "水道・電気・設備", "外構・造園", "土木・解体",
  "学習塾（個別指導・小中高）", "汎用（例：クリーニング）",
];

// Overpass に頼む店舗系のタグ（ここに無いものは店として扱わない）
const AMENITY = "restaurant|cafe|fast_food|bar|pub|biergarten|ice_cream|food_court|nightclub|language_school|driving_school|music_school|dancing_school|college";
const SHOP = "hairdresser|barber|beauty|nail|eyelash|massage|clothes|boutique|fashion|second_hand|kimono|shoes|bag|accessories|bakery|pastry|confectionery|cake|coffee|laundry|dry_cleaning";
const HEALTH = "physiotherapist|chiropractor|osteopath|acupuncture";
const OFFICE = "estate_agent|architect|construction_company";
const CRAFT = "painter|roofer|plumber|electrician|hvac|demolition|landscaping|gardener|carpenter|builder";

// 問い合わせ文（around＝中心と半径、bbox＝南・西・北・東）
export function overpassQuery(area) {
  const where = area.bbox
    ? `(${area.bbox.south},${area.bbox.west},${area.bbox.north},${area.bbox.east})`
    : `(around:${Math.min(Math.round(area.radius), 10000)},${area.center.lat},${area.center.lng})`;
  return `[out:json][timeout:25];
(
  nwr["amenity"~"^(${AMENITY})$"]${where};
  nwr["shop"~"^(${SHOP})$"]${where};
  nwr["healthcare"~"^(${HEALTH})$"]${where};
  nwr["office"~"^(${OFFICE})$"]${where};
  nwr["craft"~"^(${CRAFT})$"]${where};
);
out center tags;`;
}

// Overpass を呼ぶ。公開サーバーは IP ごとの利用枠（429）や混みあい（502・503・504）で落ちることがあるため、
// 別のサーバー（ミラー）へ順に切り替える。どれも駄目なら、理由（HTTP の状態）つきで失敗にする。
export const OVERPASS_MIRRORS = [
  OVERPASS_URL,
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
export async function overpassFetch(query, fetchImpl = fetch, mirrors = OVERPASS_MIRRORS) {
  const body = "data=" + encodeURIComponent(query);
  const seen = [];
  for (const url of mirrors) {
    let r;
    try {
      r = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
        body,
      });
    } catch (e) {
      seen.push(`${new URL(url).hostname}:通信できず`);
      continue;
    }
    if (r.ok) {
      const j = await r.json();
      return Array.isArray(j.elements) ? j.elements : [];
    }
    seen.push(`${new URL(url).hostname}:${r.status}`);
  }
  throw Object.assign(new Error(`Overpass ${seen.join(" / ")}`), { reason: "OVERPASS", detail: seen.join(" / ") });
}

// ---------- 業種 ----------
// タグ（と店名）から、33業種のラベルを決める。決まらなければ ""（店として扱わない）
export function industryOfTags(tags = {}, name = "") {
  const cuisine = String(tags.cuisine || "").toLowerCase().split(/[;,]/).map((s) => s.trim());
  const C = (...xs) => xs.some((x) => cuisine.includes(x));
  const am = tags.amenity || "";
  const shop = tags.shop || "";
  const hc = tags.healthcare || "";
  const office = tags.office || "";
  const craft = tags.craft || "";

  if (["restaurant", "cafe", "fast_food", "bar", "pub", "biergarten", "ice_cream", "food_court", "nightclub"].includes(am) || shop === "bakery" || shop === "pastry" || shop === "confectionery" || shop === "cake" || shop === "coffee") {
    if (C("sushi")) return "寿司・割烹";
    if (C("ramen")) return "ラーメン・中華そば";
    if (C("yakitori")) return "焼き鳥・やきとん";
    if (C("izakaya")) return "居酒屋・大衆酒場";
    if (am === "cafe" || shop === "coffee" || C("coffee_shop", "cafe", "tea")) return "カフェ・喫茶";
    if (C("barbecue", "yakiniku")) return "焼肉・ホルモン";
    if (C("soba", "udon")) return "そば・うどん";
    if (am === "ice_cream" || shop === "bakery" || shop === "pastry" || shop === "confectionery" || shop === "cake" || C("bakery", "pastry", "cake", "dessert", "ice_cream")) return "パン・洋菓子・和菓子";
    if (C("italian", "french", "pizza", "pasta", "bistro", "spanish")) return "イタリアン・フレンチ・ビストロ";
    if (C("chinese", "dumpling", "taiwanese")) return "中華・餃子";
    if (am === "bar" || am === "pub" || am === "nightclub" || am === "biergarten") return "バー・スナック";
    return "定食・食堂・とんかつ・洋食"; // restaurant・fast_food・food_court（和食・洋食・定食など）
  }
  if (shop === "hairdresser") return "美容室（ヘア）";
  if (shop === "barber") return "理容室・バーバー";
  if (shop === "beauty") return "エステ・脱毛";
  if (shop === "nail" || shop === "eyelash") return "ネイル・まつげ";
  if (shop === "second_hand") return "古着";
  if (shop === "kimono") return "呉服・着物";
  if (shop === "shoes" || shop === "bag" || shop === "accessories") return "靴・バッグ・小物";
  if (shop === "clothes" || shop === "boutique" || shop === "fashion") return "セレクト・婦人服";
  if (hc === "physiotherapist" || hc === "chiropractor" || hc === "osteopath") return /整骨|接骨/.test(name) ? "整骨院・接骨院" : "整体・カイロ";
  if (hc === "acupuncture") return "鍼灸";
  if (shop === "massage") return /整体/.test(name) ? "整体・カイロ" : "リラクゼーション";
  if (office === "estate_agent") return /買取|売買/.test(name) ? "売買・買取" : "賃貸仲介";
  if (craft === "painter" || craft === "roofer") return "外壁・屋根塗装";
  if (craft === "plumber" || craft === "electrician" || craft === "hvac") return "水道・電気・設備";
  if (craft === "demolition") return "土木・解体";
  if (craft === "landscaping" || craft === "gardener") return "外構・造園";
  if (craft === "carpenter" || craft === "builder" || office === "architect" || office === "construction_company") return "工務店・注文住宅・リフォーム";
  if (["language_school", "driving_school", "music_school", "dancing_school", "college"].includes(am)) return "学習塾（個別指導・小中高）";
  if (shop === "laundry" || shop === "dry_cleaning") return "汎用（例：クリーニング）";
  return "";
}

export const groupOf = (industry) => (FOOD_ITEMS.includes(industry) ? "food" : "other");

// ---------- 営業時間 ----------
const DAY_KEYS = { Mo: "mon", Tu: "tue", We: "wed", Th: "thu", Fr: "fri", Sa: "sat", Su: "sun" };
const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_NAME = ["月", "火", "水", "木", "金", "土", "日"];
const UNKNOWN = "時間不明";

// OSM の opening_hours（例：「Mo-Fr 11:00-14:00,17:00-22:00; Sa,Su 10:00-20:00」）を、曜日ごとの形にする。
// 変換できない形は、全曜日「時間不明」にして返す（店を落とさない）。
export function parseOpeningHours(text) {
  const raw = String(text || "").trim();
  const blank = () => Object.fromEntries(DAY_ORDER.map((d) => [d, null]));
  if (!raw) return null;
  const all = Object.fromEntries(DAY_ORDER.map((d) => [d, UNKNOWN]));
  if (/^24\/7$/i.test(raw)) return Object.fromEntries(DAY_ORDER.map((d) => [d, "24時間"]));
  const hours = blank();
  for (const rule of raw.split(";").map((s) => s.trim()).filter(Boolean)) {
    const m = rule.match(/^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:,|(?=\s)))+)\s+(.+)$/);
    let days;
    let body;
    if (m) {
      days = expandDays(m[1]);
      body = m[2];
    } else {
      days = DAY_ORDER.slice();
      body = rule;
    }
    if (!days) return all;
    const b = body.trim();
    if (/^(off|closed)$/i.test(b)) { for (const d of days) hours[d] = null; continue; }
    const spans = b.split(",").map((s) => s.trim());
    const ok = spans.every((s) => /^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(s));
    if (!ok) return all;
    const text2 = spans.map((s) => s.replace("-", "〜")).join(" / ");
    for (const d of days) hours[d] = text2;
  }
  return hours;
}

// 「Mo-Fr」「Sa,Su」などを、曜日の並びにする（読めなければ null）
function expandDays(part) {
  const days = new Set();
  for (const seg of part.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [a, b] = seg.split("-");
    if (!DAY_KEYS[a]) return null;
    if (!b) { days.add(DAY_KEYS[a]); continue; }
    if (!DAY_KEYS[b]) return null;
    const ia = DAY_ORDER.indexOf(DAY_KEYS[a]);
    const ib = DAY_ORDER.indexOf(DAY_KEYS[b]);
    for (let i = ia; ; i = (i + 1) % 7) { days.add(DAY_ORDER[i]); if (i === ib) break; }
  }
  return [...days];
}

// 曜日ごとの形 → 画面の「営業時間」の文字（月から日の順）
export function hoursText(hours) {
  if (!hours) return "";
  return DAY_ORDER.map((d, i) => `${DAY_NAME[i]}：${hours[d] || "定休日"}`).join("\n");
}

// ---------- 住所・連絡先 ----------
export function addressOf(tags = {}) {
  const t = tags;
  const pref = t["addr:province"] || t["addr:state"] || t["addr:prefecture"] || "";
  const city = t["addr:city"] || "";
  const area = t["addr:suburb"] || t["addr:quarter"] || t["addr:neighbourhood"] || t["addr:district"] || "";
  const no = t["addr:housenumber"] || t["addr:block_number"] || "";
  const s = [pref, city, area, no].filter(Boolean).join("");
  return s;
}

export function contactOf(tags = {}) {
  return {
    phone: tags.phone || tags["contact:phone"] || "",
    // サイトは、website・contact:website・url のどれかがあれば「ある」（外すのに使う）
    website: tags.website || tags["contact:website"] || tags.url || tags["contact:url"] || "",
    insta: tags["contact:instagram"] || tags.instagram || "",
  };
}

// ---------- 要素 → 店 ----------
// Overpass の要素（node・way・relation）を、画面用の店の形にする。店名・業種が無いものは外す。
export function shopOfElement(el) {
  const tags = el.tags || {};
  // 閉店・休業（disused・abandoned など）は外す
  if (Object.keys(tags).some((k) => /^(disused|abandoned|was):/.test(k))) return null;
  const name = String(tags.name || "").trim();
  if (!name) return null;
  const industry = industryOfTags(tags, name);
  if (!industry) return null;
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  const c = contactOf(tags);
  return {
    id: `osm:${el.type}/${el.id}`,
    name,
    industry,
    group: groupOf(industry),
    address: addressOf(tags),
    lat,
    lng,
    hours: parseOpeningHours(tags.opening_hours) || Object.fromEntries(DAY_ORDER.map((d) => [d, UNKNOWN])),
    hasHours: !!tags.opening_hours,
    phone: c.phone,
    website: c.website,
    // チェーン店の印（OSM の brand。チェーンの各店に付いている）。あれば候補から外す
    brand: tags.brand || tags["brand:wikidata"] || tags["name:brand"] || "",
    insta: c.insta,
    opened: null,
    staff: null,
    visited: false,
    types: [tags.amenity, tags.shop, tags.healthcare, tags.office, tags.craft, tags.cuisine].filter(Boolean),
  };
}

// 店の一覧：要素を店にし、同じ店の重複を除く
export function shopsOfElements(elements) {
  const seen = new Set();
  const out = [];
  for (const el of elements) {
    const s = shopOfElement(el);
    if (!s || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}

// 中心からの距離（メートル。近似）
export function distanceM(center, shop) {
  if (shop.lat == null || shop.lng == null) return Infinity;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(shop.lat - center.lat);
  const dLng = toRad(shop.lng - center.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(center.lat)) * Math.cos(toRad(shop.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
