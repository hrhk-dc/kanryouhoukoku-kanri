// Googleマップのリンクから店舗情報を読み取る（Cloudflare Pages Functions：/api/maps-info）
//  1. 短縮リンク（maps.app.goo.gl）をたどって本来のURLを取得
//  2. URLから店舗名と緯度経度を取り出す
//  3. 国土地理院の逆ジオコーダーで「○○県○○市／区」と町名を取得（無料・キー不要）
//  4. Cloudflareの環境変数 GOOGLE_MAPS_API_KEY があれば、Google Places APIで
//     住所・電話番号・営業時間・業種・評価・ホームページも取得

import { classifyIndustry } from "../../public/industry.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const ALLOWED = /^(maps\.app\.goo\.gl|goo\.gl|(www\.)?google\.[a-z.]+|maps\.google\.[a-z.]+)$/i;

let muniCache = null;
async function muniTable() {
  if (muniCache) return muniCache;
  const txt = await (await fetch("https://maps.gsi.go.jp/js/muni.js")).text();
  const map = {};
  for (const m of txt.matchAll(/MUNI_ARRAY\["(\d+)"\]\s*=\s*'([^']*)'/g)) {
    const [, code, val] = m;
    const p = val.split(",");
    // 例："横浜市　鶴見区"（政令市の区）／"新宿区"（東京23区）／"町田市"
    const parts = (p[3] || "").split(/[\s　]+/).filter(Boolean);
    let city = "", ward = "";
    if (parts.length >= 2) { city = parts[0]; ward = parts.slice(1).join(""); }
    else if (p[1] === "東京都" && /区$/.test(parts[0] || "")) { ward = parts[0]; }
    else { city = parts[0] || ""; }
    map[String(parseInt(code, 10))] = { pref: p[1], city, ward };
  }
  muniCache = map;
  return map;
}

function parseMapsUrl(u) {
  const out = {};
  const url = new URL(u);
  // 店舗名 /maps/place/店舗名/@...
  const place = url.pathname.match(/\/maps\/place\/([^/@]+)/);
  if (place) {
    let n = place[1].replace(/\+/g, " ");
    for (let k = 0; k < 2 && /%[0-9A-F]{2}/i.test(n); k++) { try { n = decodeURIComponent(n); } catch { break; } }
    out.name = n.trim();
  }
  // 店舗のピン位置（!3d緯度!4d経度）を優先、なければ画面中心（@緯度,経度）
  const dec = (() => { try { return decodeURIComponent(u); } catch { return u; } })();
  const pin = dec.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  const at = dec.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  const q = url.pathname.startsWith("/maps") ? (url.searchParams.get("q") || url.searchParams.get("query") || "") : "";
  const qll = q.match(/^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
  const ll = pin || at || qll;
  if (ll) { out.lat = parseFloat(ll[1]); out.lng = parseFloat(ll[2]); }
  if (!out.name && q && !qll) out.name = q.trim();
  return out;
}

const isMapsPage = (u) => /(^|\.)google\.[a-z.]+$/i.test(u.hostname) && u.pathname.startsWith("/maps")
  || /^maps\.google\.[a-z.]+$/i.test(u.hostname);

// 短縮リンク（maps.app.goo.gl など）だけをたどって、Googleマップの本来のURLを得る。
// Googleマップ本体のページは取りに行かない（サーバーからだとロボット確認画面に回されるため）
async function resolve(link) {
  let cur = link;
  for (let i = 0; i < 8; i++) {
    const u = new URL(cur);
    // ロボット確認・同意画面に回されたら、continue= の先（本来のURL）を使う
    if (/\/sorry\//.test(u.pathname) || /^consent\./i.test(u.hostname)) {
      const c = u.searchParams.get("continue");
      if (c) { cur = decodeURIComponent(c); continue; }
      return { finalUrl: cur, html: "", blocked: true };
    }
    if (isMapsPage(u)) return { finalUrl: cur, html: "" };
    const r = await fetch(cur, { redirect: "manual", headers: { "User-Agent": UA, "Accept-Language": "ja,en;q=0.5" } });
    const loc = r.headers.get("location");
    if (r.status >= 300 && r.status < 400 && loc) { cur = new URL(loc, cur).href; continue; }
    const html = r.status === 200 ? await r.text() : "";
    return { finalUrl: cur, html };
  }
  return { finalUrl: cur, html: "" };
}

function fromHtml(html) {
  const out = {};
  if (!html) return out;
  const og = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) || html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:title"/i);
  if (og) out.name = og[1].replace(/\s*[-·|]\s*Google\s*(マップ|Maps).*$/i, "").split(" · ")[0].trim();
  const center = html.match(/center=(-?\d+\.\d+)%2C(-?\d+\.\d+)/);
  if (center) { out.lat = parseFloat(center[1]); out.lng = parseFloat(center[2]); }
  return out;
}


// 住所の文字列から 都道府県／市／区 を分ける（座標から取れなかった時の予備）
function splitPlace(text) {
  const t = String(text || "").replace(/^日本[、,]?\s*/, "").replace(/〒?\s*\d{3}-?\d{4}\s*/, "").trim();
  const m = t.match(/^(北海道|東京都|京都府|大阪府|.{2,3}?県)\s*(.*)$/);
  if (!m) return {};
  const pref = m[1];
  const rest = m[2];
  let city = "", ward = "";
  if (pref === "東京都") {
    const w = rest.match(/^([^市区]+区)/);
    if (w) ward = w[1];
    else { const c = rest.match(/^(.+?市)/); if (c) city = c[1]; }
  } else {
    const c = rest.match(/^(.+?市|.+?郡[^市区町村]+[町村]|[^市区]+?[町村])/);
    if (c) city = c[1];
    const w = rest.slice(city.length).match(/^([^市区]+区)/);
    if (w) ward = w[1];
  }
  return { prefecture: pref, city, ward };
}

// 店舗名に住所などが続けて入っていたら、店舗名の部分だけにする
function cleanName(name) {
  let n = String(name || "").split(/\r?\n/)[0].trim();
  const i = n.search(/〒|\d{3}-\d{4}|(北海道|東京都|京都府|大阪府|[^\s、,]{2,3}県)[^\s]*?[市区町村郡]/);
  let rest = "";
  if (i > 0) { rest = n.slice(i); n = n.slice(0, i); }
  n = n.replace(/[\s　、,・｜|]+$/, "").trim();
  return { name: n, rest: rest.trim() };
}

async function gsiAddress(lat, lng) {
  const r = await fetch(`https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${lat}&lon=${lng}`);
  const j = await r.json();
  const res = j?.results;
  if (!res?.muniCd) return {};
  const t = await muniTable();
  const m = t[String(parseInt(res.muniCd, 10))] || {};
  return { prefecture: m.pref || "", city: m.city || "", ward: m.ward || "", town: res.lv01Nm && res.lv01Nm !== "－" ? res.lv01Nm : "" };
}

// お店のホームページの題名・説明文を読んで、業種のヒントにする（3秒で諦める）
async function siteText(url) {
  try {
    const r = await fetch(url, { redirect: "follow", headers: { "User-Agent": UA, "Accept-Language": "ja,en;q=0.5" }, signal: AbortSignal.timeout(3000) });
    if (!r.ok) return "";
    const html = (await r.text()).slice(0, 200000);
    const pick = (re) => (html.match(re) || [])[1] || "";
    return [pick(/<title[^>]*>([^<]{0,200})/i), pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{0,300})/i), pick(/<meta[^>]+property=["']og:(?:title|description)["'][^>]+content=["']([^"']{0,300})/i), pick(/<meta[^>]+name=["']keywords["'][^>]+content=["']([^"']{0,300})/i)].join(" ");
  } catch { return ""; }
}
// Googleの業種名のうち、何も分からない汎用の語は除く
const GENERIC = new Set(["point_of_interest", "establishment", "store", "service", "health", "finance", "general_contractor_", "premise", "political", "locality", "food_store"]);
const usefulRaw = (raw) => String(raw || "").split(/\s+/).filter((w) => w && !GENERIC.has(w)).join(" ");

async function placesLookup(key, name, lat, lng) {
  const body = { textQuery: name, languageCode: "ja", regionCode: "JP" };
  if (lat && lng) body.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius: 300 } };
  const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": [
        "places.displayName", "places.formattedAddress", "places.nationalPhoneNumber",
        "places.regularOpeningHours.weekdayDescriptions", "places.primaryTypeDisplayName", "places.primaryType", "places.types",
        "places.rating", "places.userRatingCount", "places.websiteUri", "places.location", "places.addressComponents", "places.editorialSummary"
      ].join(",")
    },
    body: JSON.stringify(body)
  });
  const j = await r.json();
  if (!r.ok) {
    const reason = j?.error?.details?.find((d) => d.reason)?.reason || j?.error?.status || "";
    const hint = {
      API_KEY_INVALID: "キーの文字列が正しくありません。Google Cloudの「認証情報」からキーをコピーし直し、Cloudflareの GOOGLE_MAPS_API_KEY に貼り直してください",
      SERVICE_DISABLED: "Google Cloudで「Places API (New)」が有効になっていません",
      API_KEY_SERVICE_BLOCKED: "キーの「APIの制限」で Places API (New) が許可されていません",
      API_KEY_HTTP_REFERRER_BLOCKED: "キーの「アプリケーションの制限」をウェブサイトにしていると使えません（「なし」にしてください）",
      BILLING_DISABLED: "Google Cloudの請求先アカウントが有効になっていません",
      PERMISSION_DENIED: "このキーではPlaces APIを使う権限がありません（APIの有効化・キーの制限を確認してください）"
    }[reason];
    throw new Error(hint || j?.error?.message || `Places API ${r.status}`);
  }
  const p = j.places?.[0];
  if (!p) return {};
  // 住所の部品から 都道府県／市／区 を取り出す
  const comp = (type) => (p.addressComponents || []).find((c) => (c.types || []).includes(type))?.longText || "";
  const pref = comp("administrative_area_level_1");
  const loc = comp("locality");
  const sub = comp("sublocality_level_1");
  let city = loc, ward = "";
  if (/区$/.test(loc)) { ward = loc; city = ""; }
  if (/区$/.test(sub) && !ward) ward = sub;
  return {
    pPrefecture: pref, pCity: city, pWard: ward,
    name: p.displayName?.text || "",
    address: (p.formattedAddress || "").replace(/^日本、?\s*/, "").replace(/^〒\d{3}-\d{4}\s*/, ""),
    phone: p.nationalPhoneNumber || "",
    hours: (p.regularOpeningHours?.weekdayDescriptions || []).join("\n"),
    category: [p.primaryTypeDisplayName?.text, p.primaryType, ...(p.types || [])].filter(Boolean).join(" "),
    rating: p.rating ? `★${p.rating}（${p.userRatingCount || 0}件）` : "",
    website: p.websiteUri || "",
    summary: p.editorialSummary?.text || "",
    lat: p.location?.latitude, lng: p.location?.longitude
  };
}

async function handle(req, env) {
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  try {
    const link = new URL(req.url).searchParams.get("url") || "";
    let host = "";
    try { host = new URL(link).hostname; } catch { /* noop */ }
    if (!ALLOWED.test(host)) {
      return new Response(JSON.stringify({ ok: false, error: "GoogleマップのURLではありません" }), { status: 400, headers });
    }

    const { finalUrl, html } = await resolve(link);
    const info = { ...fromHtml(html), ...parseMapsUrl(finalUrl) };
    // 英数字だけの長い文字列（確認画面の識別子など）は店舗名として使わない
    if (info.name && /^[A-Za-z0-9_-]{25,}$/.test(info.name)) delete info.name;
    const notes = [];

    // 貼り付け時に混ざりがちな空白・改行・引用符を取り除く
    const key = (env.GOOGLE_MAPS_API_KEY || "").trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
    if (key && (info.name || info.lat)) {
      try { Object.assign(info, Object.fromEntries(Object.entries(await placesLookup(key, info.name || `${info.lat},${info.lng}`, info.lat, info.lng)).filter(([, v]) => v))); }
      catch (e) {
        // キーの中身は出さず、形だけ確認できるようにする（正しいキーは AIza で始まる39文字）
        const shape = `［設定されているキー：${key.length}文字・${key.startsWith("AIza") ? "AIzaで始まる" : "AIzaで始まらない"}］`;
        notes.push("店舗の詳細（電話番号など）を取得できませんでした：" + e.message + (/キーの文字列/.test(e.message) ? shape : ""));
      }
    } else if (!key) {
      notes.push("営業時間・業種・電話番号は、管理者がGoogle Places APIキーを設定すると自動で入ります");
    }

    if (info.lat && info.lng) {
      try { Object.assign(info, await gsiAddress(info.lat, info.lng)); }
      catch (e) { notes.push("地域（県・市区）を取得できませんでした"); }
    }
    // 店舗がGoogleで見つからなかったときは、「店舗名＋地域」で探し直す
    if (key && info.name && !info.categoryFound && !info.phone && !info.hours && (info.prefecture || info.city || info.ward)) {
      try {
        const again = await placesLookup(key, `${info.name} ${[info.prefecture, info.city, info.ward].filter(Boolean).join("")}`, info.lat, info.lng);
        Object.assign(info, Object.fromEntries(Object.entries(again).filter(([k, v]) => v && !/^lat$|^lng$/.test(k) && !info[k])));
      } catch { /* 探し直しの失敗は無視 */ }
    }
    // 県・市・区は別々の項目で返す。座標から取れなければ、Googleの住所の部品 → 住所の文字 の順で補う
    const fb = splitPlace(info.address);
    if (!info.prefecture) info.prefecture = info.pPrefecture || fb.prefecture || "";
    if (!info.city && !info.ward) {
      info.city = info.pCity || fb.city || "";
      info.ward = info.pWard || fb.ward || "";
    }
    delete info.pPrefecture; delete info.pCity; delete info.pWard;
    // 店舗名に住所などが混ざっていたら取り除く
    if (info.name) {
      const c = cleanName(info.name);
      if (c.name) info.name = c.name;
      if (c.rest && !info.address) info.address = c.rest.replace(/^〒?\s*\d{3}-?\d{4}\s*/, "");
    }
    if (!info.prefecture && info.address) Object.assign(info, Object.fromEntries(Object.entries(splitPlace(info.address)).filter(([, v]) => v)));
    // 業種：Googleの業種名から「飲食店・美容院・アパレル・整体・整骨院・不動産・建築・土木・その他」に選別（情報がなければ空欄）
    // ① Googleの業種名 ② 店舗名 ③ Googleの紹介文 ④ お店のホームページ の順に、手がかりを探す
    const raw = usefulRaw(info.category);
    info.categoryRaw = raw;
    let industry = classifyIndustry(raw, info.name);
    let source = raw ? "Googleの業種名" : "";
    if ((!industry || industry === "その他") && info.summary) {
      const s = classifyIndustry("", info.summary);
      if (s) { industry = s; source = "Googleの紹介文"; }
    }
    if ((!industry || industry === "その他") && info.website) {
      const w = classifyIndustry("", await siteText(info.website));
      if (w) { industry = w; source = "ホームページ"; }
    }
    if (industry && source === "" && info.name) source = "店舗名";
    info.category = industry;
    info.categorySource = industry ? source : "";
    if (!industry) notes.push("業種の手がかりがGoogleマップに見つかりませんでした（手で選んでください）");
    delete info.summary;
    info.area = [info.prefecture, info.city, info.ward].filter(Boolean).join("");
    if (!info.address && info.area) info.address = info.area + (info.town || "");

    const found = !!(info.name || info.area);
    return new Response(JSON.stringify({ ok: found, ...info, finalUrl, notes, error: found ? "" : "このリンクから店舗の情報を読み取れませんでした" }), { status: 200, headers });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: "読み取り中にエラーが起きました：" + e.message }), { status: 200, headers });
  }
}

export const onRequestGet = ({ request, env }) => handle(request, env);
