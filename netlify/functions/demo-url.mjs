// Claude Codeで作ったデモサイトのURLを、案件番号ごとに保存・取得する（Netlify Function）
//
// 保存（Claude Codeから）：
//   POST /api/demo-url  { "caseNo": "A012", "url": "https://xxx.netlify.app", "token": "合言葉" }
// 取得（アプリから・ログイン中のメンバーだけ）：
//   GET  /api/demo-url  （Authorization: Bearer <FirebaseのIDトークン>）
//
// 保存先は Netlify Blobs（Netlifyに付いている保存場所）。Firebaseの秘密鍵は使わない。
// Netlifyの環境変数に必要なのは INTEGRATION_TOKEN（合言葉）だけ。
import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";

const FIREBASE_API_KEY = "AIzaSyC7DblMiGT1f5bM9eIVka4xjndbi1cKpOc"; // 公開して問題ないウェブ用の値
const PROJECT_ID = "dc-report-8e1d1";
const OWNER = "hrhk@dc-hm.com";

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});
const store = () => getStore({ name: "demo-urls", consistency: "strong" });

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

export default async (req) => {
  try {
    if (req.method === "GET") {
      const idToken = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      if (!idToken || !(await checkMember(idToken))) return json(401, { ok: false, error: "ログインしたメンバーだけが見られます" });
      const s = store();
      const { blobs } = await s.list();
      const items = {};
      await Promise.all(blobs.map(async ({ key }) => { const v = await s.get(key, { type: "json" }); if (v?.url) items[key] = v; }));
      return json(200, { ok: true, items });
    }

    if (req.method !== "POST") return json(405, { ok: false, error: "GETかPOSTで送ってください" });
    const TOKEN = (process.env.INTEGRATION_TOKEN || "").trim();
    if (!TOKEN) return json(503, { ok: false, error: "連携の設定がまだです（Netlifyの環境変数 INTEGRATION_TOKEN が必要）" });

    let body;
    try { body = await req.json(); } catch { return json(400, { ok: false, error: "JSONの形式が正しくありません" }); }
    const given = Buffer.from(String(body.token || "").trim());
    const want = Buffer.from(TOKEN);
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return json(401, { ok: false, error: "合言葉（token）が違います" });

    const caseNo = String(body.caseNo || "").trim().toUpperCase();
    const url = String(body.url || "").trim();
    if (!/^[A-Z]{1,3}\d{3}$|^DC-?\d+$/.test(caseNo)) return json(400, { ok: false, error: "案件番号の形式が正しくありません（例：A012）" });
    if (!/^https:\/\/[^\s"'<>]+$/.test(url)) return json(400, { ok: false, error: "URLは https:// から始めてください" });

    if (body.delete === true) { await store().delete(caseNo); return json(200, { ok: true, caseNo, deleted: true }); }
    await store().setJSON(caseNo, { url, at: new Date().toISOString() });
    return json(200, { ok: true, caseNo, url, message: `案件 ${caseNo} にデモサイトURLを登録しました` });
  } catch (e) {
    return json(500, { ok: false, error: "処理中にエラーが起きました：" + e.message });
  }
};

export const config = { path: "/api/demo-url" };
