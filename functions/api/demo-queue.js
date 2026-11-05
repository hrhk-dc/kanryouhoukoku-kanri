// 翌日訪問リストに保存されたGoogleマップのリンクを「デモサイト作成の依頼」として預かる（/api/demo-queue）
//
// 依頼を積む（アプリから・ログイン中のメンバーだけ）：
//   POST /api/demo-queue  Authorization: Bearer <FirebaseのIDトークン>
//   { "items": [ { "caseNo": "A020", "visitDate": "2026-11-06", "mapsUrl": "https://maps.app.goo.gl/...", "shopName": "…", ... } ] }
// 依頼を受け取る（Claude Codeから・合言葉が必要）：
//   GET  /api/demo-queue  X-Integration-Token: <合言葉>
// 作り終えたら /api/demo-url にURLを登録すると、その案件の依頼は自動で消える。
// 取り消し：DELETE /api/demo-queue?caseNo=A020  X-Integration-Token: <合言葉>
//
// 保存先は /api/demo-url と同じ Cloudflare KV（DEMO_URLS）。キーは "queue:<案件番号>"。

import { checkMember, sameText } from "./demo-url.js";

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});
const CASE = /^[A-Z]{1,3}\d{3}$|^DC-?\d+$/;
const MAPS = /^https:\/\/(maps\.app\.goo\.gl|goo\.gl|(www\.)?google\.[a-z.]+|maps\.google\.[a-z.]+)\/[^\s"'<>]*$/i;
const KEEP = ["shopName", "prefecture", "city", "ward", "category", "hours", "address", "phone", "rating", "website", "visitTime", "personName"];

function tokenOk(request, env) {
  const TOKEN = String(env.INTEGRATION_TOKEN || "").trim();
  const got = String(request.headers.get("x-integration-token") || "").trim();
  return TOKEN && got && sameText(got, TOKEN);
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DEMO_URLS) return json(503, { ok: false, error: "保存場所（KV：DEMO_URLS）が紐付けられていません" });
    const idToken = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!idToken || !(await checkMember(idToken))) return json(401, { ok: false, error: "ログインしたメンバーだけが依頼できます" });
    let body;
    try { body = await request.json(); } catch { return json(400, { ok: false, error: "JSONの形式が正しくありません" }); }
    const list = Array.isArray(body.items) ? body.items.slice(0, 50) : [];
    const queued = [];
    for (const it of list) {
      const caseNo = String(it.caseNo || "").trim().toUpperCase();
      const mapsUrl = String(it.mapsUrl || "").trim();
      if (!CASE.test(caseNo) || !MAPS.test(mapsUrl)) continue;
      // 同じマップのリンクでデモが作成済みなら、依頼し直さない
      const done = await env.DEMO_URLS.get(caseNo, "json");
      if (done?.url && done.mapsUrl === mapsUrl) continue;
      const info = {};
      for (const k of KEEP) if (it[k]) info[k] = String(it[k]).slice(0, 2000);
      await env.DEMO_URLS.put("queue:" + caseNo, JSON.stringify({
        caseNo, mapsUrl, visitDate: String(it.visitDate || "").slice(0, 10), info, at: new Date().toISOString()
      }));
      queued.push(caseNo);
    }
    return json(200, { ok: true, queued });
  } catch (e) {
    return json(500, { ok: false, error: "処理中にエラーが起きました：" + e.message });
  }
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env.DEMO_URLS) return json(503, { ok: false, error: "保存場所（KV：DEMO_URLS）が紐付けられていません" });
    if (!tokenOk(request, env)) return json(401, { ok: false, error: "合言葉が違います" });
    const items = [];
    let cursor;
    do {
      const page = await env.DEMO_URLS.list({ prefix: "queue:", cursor });
      for (const { name } of page.keys) {
        const v = await env.DEMO_URLS.get(name, "json");
        if (v) items.push(v);
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    items.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    return json(200, { ok: true, items });
  } catch (e) {
    return json(500, { ok: false, error: "処理中にエラーが起きました：" + e.message });
  }
}

export async function onRequestDelete({ request, env }) {
  if (!env.DEMO_URLS) return json(503, { ok: false, error: "保存場所（KV：DEMO_URLS）が紐付けられていません" });
  if (!tokenOk(request, env)) return json(401, { ok: false, error: "合言葉が違います" });
  const caseNo = String(new URL(request.url).searchParams.get("caseNo") || "").trim().toUpperCase();
  if (!CASE.test(caseNo)) return json(400, { ok: false, error: "案件番号の形式が正しくありません" });
  await env.DEMO_URLS.delete("queue:" + caseNo);
  return json(200, { ok: true, caseNo, deleted: true });
}
