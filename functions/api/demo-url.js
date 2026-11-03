// Claude Codeで作ったデモサイトのURLを、案件番号ごとに保存・取得する（Cloudflare Pages Functions：/api/demo-url）
//
// 保存（Claude Codeから）：
//   POST /api/demo-url  { "caseNo": "A012", "url": "https://xxx.netlify.app", "token": "合言葉" }
// 取得（アプリから・ログイン中のメンバーだけ）：
//   GET  /api/demo-url  （Authorization: Bearer <FirebaseのIDトークン>）
//
// 保存先は Cloudflare KV（名前空間を DEMO_URLS として紐付ける）。Firebaseの秘密鍵は使わない。
// 必要な設定：KVの紐付け DEMO_URLS と、環境変数 INTEGRATION_TOKEN（合言葉）だけ。

const FIREBASE_API_KEY = "AIzaSyC7DblMiGT1f5bM9eIVka4xjndbi1cKpOc"; // 公開して問題ないウェブ用の値
const PROJECT_ID = "dc-report-8e1d1";
const OWNER = "hrhk@dc-hm.com";

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});

// 文字列を比べるのにかかる時間から合言葉を推測されないよう、常に全文字を比べる
function sameText(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

// ログイン中のメンバーかどうかを、本人のIDトークンで確かめる
async function checkMember(idToken) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken })
  });
  const u = (await r.json())?.users?.[0];
  if (!u?.email || !u.emailVerified) return false;
  const email = u.email.toLowerCase();
  if (email === OWNER) return true;
  const m = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/settings/members`, {
    headers: { Authorization: `Bearer ${idToken}` }
  });
  if (!m.ok) return false;
  const f = (await m.json())?.fields || {};
  const list = (k) => (f[k]?.arrayValue?.values || []).map((v) => String(v.stringValue || "").toLowerCase());
  return list("emails").includes(email) || list("admins").includes(email);
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env.DEMO_URLS) return json(503, { ok: false, error: "保存場所（KV：DEMO_URLS）が紐付けられていません" });
    const idToken = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!idToken || !(await checkMember(idToken))) return json(401, { ok: false, error: "ログインしたメンバーだけが見られます" });
    const items = {};
    let cursor;
    do {
      const page = await env.DEMO_URLS.list({ cursor });
      await Promise.all(page.keys.map(async ({ name }) => {
        const v = await env.DEMO_URLS.get(name, "json");
        if (v?.url) items[name] = v;
      }));
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return json(200, { ok: true, items });
  } catch (e) {
    return json(500, { ok: false, error: "処理中にエラーが起きました：" + e.message });
  }
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DEMO_URLS) return json(503, { ok: false, error: "保存場所（KV：DEMO_URLS）が紐付けられていません" });
    const TOKEN = String(env.INTEGRATION_TOKEN || "").trim();
    if (!TOKEN) return json(503, { ok: false, error: "連携の設定がまだです（Cloudflareの環境変数 INTEGRATION_TOKEN が必要）" });
    let body;
    try { body = await request.json(); } catch { return json(400, { ok: false, error: "JSONの形式が正しくありません" }); }
    if (!sameText(String(body.token || "").trim(), TOKEN)) return json(401, { ok: false, error: "合言葉（token）が違います" });

    const caseNo = String(body.caseNo || "").trim().toUpperCase();
    const url = String(body.url || "").trim();
    if (!/^[A-Z]{1,3}\d{3}$|^DC-?\d+$/.test(caseNo)) return json(400, { ok: false, error: "案件番号の形式が正しくありません（例：A012）" });
    if (body.delete === true) { await env.DEMO_URLS.delete(caseNo); return json(200, { ok: true, caseNo, deleted: true }); }
    if (!/^https:\/\/[^\s"'<>]+$/.test(url)) return json(400, { ok: false, error: "URLは https:// から始めてください" });

    await env.DEMO_URLS.put(caseNo, JSON.stringify({ url, at: new Date().toISOString() }));
    return json(200, { ok: true, caseNo, url, message: `案件 ${caseNo} にデモサイトURLを登録しました` });
  } catch (e) {
    return json(500, { ok: false, error: "処理中にエラーが起きました：" + e.message });
  }
}
