// OSM（Overpass）の店舗検索のテスト（ネットワークは使わない。Overpass は偽物、Cache API は Map の偽物）
import { test } from "node:test";
import assert from "node:assert/strict";
import { industryOfTags, groupOf, parseOpeningHours, addressOf, overpassQuery, overpassFetch, shopsOfElements, hoursText, OVERPASS_URL } from "./osm.js";
import { loadPool, filterByCategory, pageOf, filterByIndustries, areaBaseKey } from "./osm-search.js";

// Cache API の偽物（max-age で期限切れ）
function fakeCache(clock) {
  const store = new Map();
  return {
    async match(key) { const e = store.get(key); if (!e || clock.now >= e.expiresAt) return undefined; return new Response(e.body); },
    async put(key, res) { const m = /max-age=(\d+)/.exec(res.headers.get("Cache-Control") || ""); if (m) store.set(key, { body: await res.text(), expiresAt: clock.now + Number(m[1]) * 1000 }); },
  };
}
const JST = (y, m, d, h) => Date.UTC(y, m - 1, d, h - 9);
const CENTER = { lat: 35.818024, lng: 139.75136 };
const GEO = { center: CENTER, radius: 2000, town: false, viewport: null };

// 偽の Overpass：食べ物・美容など、いろいろな店の要素を返す。呼ばれた URL を記録する
function fakeOverpass() {
  const hosts = [];
  const elements = [];
  for (let i = 0; i < 60; i++) {
    elements.push({ type: "node", id: 1000 + i, lat: CENTER.lat + ((i * 37) % 101) * 0.00012, lon: CENTER.lng, tags: { amenity: "restaurant", cuisine: i % 2 ? "sushi" : "japanese", name: `食店${i}`, opening_hours: "Mo-Fr 11:00-14:00; Sa,Su 10:00-20:00" } });
  }
  for (let i = 0; i < 40; i++) {
    elements.push({ type: "way", id: 2000 + i, center: { lat: CENTER.lat + ((i * 53) % 97) * 0.00012, lon: CENTER.lng + 0.0004 }, tags: { shop: "hairdresser", name: `美容${i}` } });
  }
  const fetch = async (url, init) => { hosts.push(new URL(String(url)).hostname); return { ok: true, status: 200, json: async () => ({ elements }) }; };
  return { fetch, hosts, elements };
}

test("業種：タグから今の33業種のラベルに寄せる（食べ物かどうかも決まる）", () => {
  assert.equal(industryOfTags({ amenity: "restaurant", cuisine: "sushi" }, "x"), "寿司・割烹");
  assert.equal(industryOfTags({ amenity: "cafe" }, "x"), "カフェ・喫茶");
  assert.equal(industryOfTags({ amenity: "restaurant", cuisine: "ramen" }, "x"), "ラーメン・中華そば");
  assert.equal(industryOfTags({ amenity: "bar" }, "x"), "バー・スナック");
  assert.equal(industryOfTags({ shop: "hairdresser" }, "x"), "美容室（ヘア）");
  assert.equal(industryOfTags({ shop: "massage" }, "整体院"), "整体・カイロ");
  assert.equal(industryOfTags({ craft: "plumber" }, "x"), "水道・電気・設備");
  assert.equal(industryOfTags({ shop: "laundry" }, "x"), "汎用（例：クリーニング）");
  assert.equal(industryOfTags({ shop: "supermarket" }, "x"), ""); // 店舗系でないものは扱わない
  assert.equal(groupOf("寿司・割烹"), "food");
  assert.equal(groupOf("美容室（ヘア）"), "other");
});

test("営業時間：OSMの書き方を曜日ごとの形にする。変換できないものは「時間不明」で残す", () => {
  const h = parseOpeningHours("Mo-Fr 11:00-14:00,17:00-22:00; Sa,Su 10:00-20:00");
  assert.equal(h.mon, "11:00〜14:00 / 17:00〜22:00");
  assert.equal(h.sat, "10:00〜20:00");
  assert.equal(h.sun, "10:00〜20:00");
  const off = parseOpeningHours("Mo-Su 09:00-18:00; Su off");
  assert.equal(off.sun, null);
  assert.equal(off.mon, "09:00〜18:00");
  assert.equal(parseOpeningHours("24/7").fri, "24時間");
  const bad = parseOpeningHours("Mo-Fr sometimes around noon");
  assert.equal(bad.mon, "時間不明"); // 落とさない
  assert.match(hoursText(h), /^月：11:00〜14:00 \/ 17:00〜22:00/);
});

test("住所：addr:* タグから作る（無ければ空）", () => {
  assert.equal(addressOf({ "addr:province": "埼玉県", "addr:city": "戸田市", "addr:suburb": "上戸田", "addr:housenumber": "1-2-3" }), "埼玉県戸田市上戸田1-2-3");
  assert.equal(addressOf({}), "");
});

test("問い合わせ：中心＋半径、または町名の範囲（bbox）で、ways も center で取る", () => {
  const q1 = overpassQuery({ center: CENTER, radius: 2000 });
  assert.match(q1, /nwr\["amenity"/);
  assert.match(q1, /\(around:2000,35\.818024,139\.75136\)/);
  assert.match(q1, /out center tags/);
  const q2 = overpassQuery({ bbox: { south: 35.8, west: 139.7, north: 35.9, east: 139.8 }, center: CENTER });
  assert.match(q2, /\(35\.8,139\.7,35\.9,139\.8\)/);
});

test("要素 → 店：名前と業種が無いものは外す。閉店は外す。way は center を使う", () => {
  const shops = shopsOfElements([
    { type: "way", id: 1, center: { lat: 35.8, lon: 139.7 }, tags: { shop: "hairdresser", name: "A店" } },
    { type: "node", id: 2, lat: 35.8, lon: 139.7, tags: { shop: "hairdresser" } }, // 名前なし
    { type: "node", id: 3, lat: 35.8, lon: 139.7, tags: { shop: "hairdresser", name: "閉じた店", "disused:shop": "hairdresser" } },
    { type: "node", id: 4, lat: 35.8, lon: 139.7, tags: { shop: "supermarket", name: "スーパー" } },
  ]);
  assert.deepEqual(shops.map((s) => s.name), ["A店"]);
  assert.equal(shops[0].lat, 35.8);
  assert.equal(shops[0].id, "osm:way/1");
  assert.equal(shops[0].rating, undefined); // 評価は返さない
  assert.equal(shops[0].reviews, undefined);
  assert.equal(shops[0].priceLevel, undefined);
});

test("候補：Overpass は1回だけ・OSM のホストだけに送る。20件ずつ、飲食と飲食以外が混ざる", async () => {
  const clock = { now: JST(2026, 11, 27, 10) };
  const cache = fakeCache(clock);
  const fake = fakeOverpass();
  const real = globalThis.fetch;
  globalThis.fetch = fake.fetch;
  try {
    const pool = await loadPool({ cache, geo: GEO, now: clock.now });
    assert.ok(fake.hosts.every((h) => h === new URL(OVERPASS_URL).hostname), "OSM 以外に送っていない（Google を呼ばない）");
    assert.equal(fake.hosts.length, 1);
    const sorted = filterByCategory(pool, "all", CENTER);
    const p1 = pageOf(sorted, 1);
    assert.equal(p1.shops.length, 20);
    const labels = new Set(p1.shops.map((s) => s.group));
    assert.ok(labels.has("food") && labels.has("other"), "飲食と飲食以外が混ざる");
    assert.equal(p1.hasMore, true);
    // 2ページ目は保存から。Overpass は呼ばない
    const again = await loadPool({ cache, geo: GEO, now: clock.now });
    assert.equal(fake.hosts.length, 1);
    assert.equal(again.length, pool.length);
    const p2 = pageOf(filterByCategory(again, "all", CENTER), 2);
    assert.equal(p2.shops.length, 20);
  } finally {
    globalThis.fetch = real;
  }
});

test("分類：food は飲食店だけ、other は飲食以外だけ。実用的な件数（other でも10件以上）", async () => {
  const clock = { now: JST(2026, 11, 27, 10) };
  const fake = fakeOverpass();
  const real = globalThis.fetch;
  globalThis.fetch = fake.fetch;
  try {
    const pool = await loadPool({ cache: fakeCache(clock), geo: GEO, now: clock.now });
    const food = filterByCategory(pool, "food", CENTER);
    const other = filterByCategory(pool, "other", CENTER);
    assert.ok(food.every((s) => s.group === "food"));
    assert.ok(other.every((s) => s.group === "other"));
    assert.ok(other.length >= 10, `other ${other.length}`);
  } finally {
    globalThis.fetch = real;
  }
});

test("ウェブサイトのある店は外す（今までの決まり）。旧形式の業種の名前でも絞れる", () => {
  const list = [
    { id: "a", name: "A", industry: "寿司・割烹", group: "food", lat: 35.8, lng: 139.7, website: "" },
    { id: "b", name: "B", industry: "寿司・割烹", group: "food", lat: 35.8, lng: 139.7, website: "https://example.com" },
    { id: "c", name: "C", industry: "美容室（ヘア）", group: "other", lat: 35.8, lng: 139.7, website: "" },
  ];
  assert.deepEqual(filterByCategory(list, "all", CENTER).map((s) => s.id).sort(), ["a", "c"]);
  assert.deepEqual(filterByIndustries(list, ["寿司・割烹", "知らない業種"]).map((s) => s.id), ["a"]);
});

test("保存の鍵は地域ごとに分かれる", () => {
  assert.notEqual(areaBaseKey(GEO), areaBaseKey({ ...GEO, radius: 1000 }));
  assert.equal(areaBaseKey(GEO), areaBaseKey({ ...GEO }));
});

test("Overpass が混みあい（429）でも、ミラーに切り替えて取れる。全部駄目なら理由つきで失敗", async () => {
  const seen = [];
  const elements = [{ type: "node", id: 9, lat: 35.8, lon: 139.7, tags: { shop: "hairdresser", name: "ミラー店" } }];
  const fetchImpl = async (url) => {
    seen.push(new URL(String(url)).hostname);
    if (seen.length === 1) return { ok: false, status: 429, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ elements }) };
  };
  const got = await overpassFetch(overpassQuery({ center: CENTER, radius: 1000 }), fetchImpl);
  assert.equal(got.length, 1);
  assert.equal(seen.length, 2); // 1つ目が429、2つ目で取れた

  const allBad = async () => ({ ok: false, status: 504, json: async () => ({}) });
  await assert.rejects(overpassFetch(overpassQuery({ center: CENTER, radius: 1000 }), allBad), (e) => /504/.test(e.detail) && /:504/.test(e.message));
});

test("絶対条件：チェーン店（brand の印・既知の名前・複数の支店）と、サイトのある店は、候補に一つも残らない", async () => {
  const { shopOfElement } = await import("./osm.js");
  const el = (id, tags) => ({ type: "node", id, lat: CENTER.lat, lon: CENTER.lng, tags: { amenity: "restaurant", cuisine: "japanese", ...tags } });
  const shops = [
    shopOfElement(el(1, { name: "ひとりの店", opening_hours: "Mo-Su 11:00-21:00" })),                 // 独立した店：残る
    shopOfElement(el(2, { name: "ゆうえん堂 本店", brand: "ゆうえん堂" })),                            // brand の印：外す（1店舗だけ）
    shopOfElement(el(3, { name: "吉野家 上野店" })),                                                  // 既知のチェーン名：外す
    shopOfElement(el(4, { name: "サイトあり食堂", website: "https://example.com" })),                  // website：外す
    shopOfElement(el(5, { name: "URLだけの食堂", url: "https://example.org" })),                       // url だけ：サイトあり（外す）
    shopOfElement(el(6, { name: "はし本", website: "" })),                                            // 支店は別々に検索で出る
    shopOfElement(el(7, { name: "はし本 西口店", website: "https://hashimoto.example" })),             // 同じブランドの支店がサイトあり → 支店も数に入り、どちらも外す
  ].filter(Boolean);
  const out = filterByCategory(shops, "all", CENTER).map((s) => s.name).sort();
  assert.deepEqual(out, ["ひとりの店"], JSON.stringify(out));
});
