// 店舗検索（OSM）の候補プール：Overpass で1回取り、その日（JST）のあいだ保存する。
// 分類（food／other／all）とページ（20件ずつ）は、保存したプールから切り出す（Overpass は呼び直さない）。
import { overpassQuery, overpassFetch, shopsOfElements, distanceM } from "./osm.js";
import { cachedSearch } from "./search-cache.js";
import { chainIds } from "./vla-core.js";

export const PAGE_SIZE = 20;
export const MAX_PAGES = 3;
export const CATEGORY_CHOICES = ["food", "other", "all"];

// 地域（中心・半径、または町名の範囲）から、保存の鍵の前半を作る。同じ地域なら同じ鍵
export function areaBaseKey({ center, radius, town, viewport }) {
  const r5 = (n) => Number(n).toFixed(5);
  const parts = [
    `c=${r5(center.lat)},${r5(center.lng)}`,
    `r=${Math.round(Number(radius) || 0)}`,
    `t=${town ? 1 : 0}`,
    viewport ? `v=${r5(viewport.south)},${r5(viewport.west)},${r5(viewport.north)},${r5(viewport.east)}` : "v=",
  ];
  return `https://cache.local/osm/v1?${parts.join("&")}`;
}

// 候補プール（業種・分類を含む全部の店。距離順）。Overpass を呼ぶのは保存が無いときだけ
export async function loadPool({ cache, geo, now = Date.now(), hits = null, fetchImpl = fetch }) {
  const base = areaBaseKey(geo);
  const area = geo.town && geo.viewport
    ? { bbox: geo.viewport, center: geo.center }
    : { center: geo.center, radius: geo.radius };
  const { data } = await cachedSearch({
    cache, key: `${base}&pool=osm2`, now,   // osm2：チェーンの印（brand）とサイトの読み方を変えた。古い保存（osm）は使わない
    run: async () => {
      const elements = await overpassFetch(overpassQuery(area), fetchImpl);
      return { shops: shopsOfElements(elements) };
    },
  }, hits);
  return data.shops;
}

// 候補から、画面に出すものを決める（絶対条件。ここを通らないものは出さない）：
//  - ウェブサイトのある店は外す（「サイトなし」の店だけ）
//  - チェーン店は外す：OSM の brand の印、既知のチェーン名、同じブランドが検索の中に複数ある店。
//    チェーンかどうかは、サイトの有無に関係なく、検索で取れた店すべてで数える（サイトのある支店も数に入れる）
export function publishable(shops) {
  const chains = chainIds(shops.map((s) => ({ id: s.id, displayName: { text: s.name } })));
  return shops.filter((s) => !s.website && !s.brand && !chains.has(s.id));
}

// 分類（food／other／all）で切り、中心からの距離の近い順にする
export function filterByCategory(shops, category, center) {
  const pub = publishable(shops).filter((s) => category === "all" || s.group === category);
  return sortByDistance(pub, center);
}

// 1ページ分（20件）と、次があるか
export function pageOf(sorted, page) {
  const start = (page - 1) * PAGE_SIZE;
  return {
    shops: sorted.slice(start, start + PAGE_SIZE),
    hasMore: sorted.length > start + PAGE_SIZE,
    total: sorted.length,
  };
}

// 中心を付けて、距離順に並べる（画面と同じ基準）
export function sortByDistance(shops, center) {
  return shops.slice().sort((a, b) => distanceM(center, a) - distanceM(center, b));
}

// 業種の名前（旧形式）で切る。知らない名前は無視する
export function filterByIndustries(shops, names) {
  const set = new Set(names);
  return publishable(shops).filter((s) => set.has(s.industry));
}
