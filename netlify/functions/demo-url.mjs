// Claude Codeで作ったデモサイトのURLを、案件番号の訪問先に登録する（Netlify Function）
//   POST /api/demo-url  { "caseNo": "A012", "url": "https://xxx.netlify.app", "token": "連携キー" }
// Netlifyの環境変数（管理者が一度だけ設定）：
//   INTEGRATION_TOKEN         … 連携キー（自分で決めた長い文字列）
//   FIREBASE_SERVICE_ACCOUNT  … Firebaseのサービスアカウント鍵（JSONの中身をそのまま）
import crypto from "node:crypto";

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});

async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "RS256", typ: "JWT" });
  const claim = b64({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600
  });
  const sig = crypto.createSign("RSA-SHA256").update(`${head}.${claim}`).sign(sa.private_key, "base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claim}.${sig}` })
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("Googleの認証に失敗しました（サービスアカウント鍵を確認してください）");
  return j.access_token;
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "POSTで送ってください" });
  const TOKEN = process.env.INTEGRATION_TOKEN;
  const SA = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!TOKEN || !SA) return json(503, { ok: false, error: "連携の設定がまだです（Netlifyの環境変数 INTEGRATION_TOKEN と FIREBASE_SERVICE_ACCOUNT が必要）" });

  let body;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: "JSONの形式が正しくありません" }); }
  const given = String(body.token || "");
  const ok = given.length === TOKEN.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(TOKEN));
  if (!ok) return json(401, { ok: false, error: "連携キーが違います" });

  const caseNo = String(body.caseNo || "").trim().toUpperCase();
  const url = String(body.url || "").trim();
  if (!/^[A-Z]+\d{3}$|^DC-?\d+$/.test(caseNo)) return json(400, { ok: false, error: "案件番号の形式が正しくありません（例：A012）" });
  if (!/^https:\/\/[^\s]+$/.test(url)) return json(400, { ok: false, error: "URLは https:// から始めてください" });

  try {
    const sa = JSON.parse(SA);
    const at = await accessToken(sa);
    const base = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents`;
    const q = await fetch(`${base}:runQuery`, {
      method: "POST",
      headers: { Authorization: `Bearer ${at}`, "Content-Type": "application/json" },
      body: JSON.stringify({ structuredQuery: {
        from: [{ collectionId: "visits" }],
        where: { fieldFilter: { field: { fieldPath: "caseNo" }, op: "EQUAL", value: { stringValue: caseNo } } },
        limit: 1
      } })
    });
    const rows = await q.json();
    const name = rows?.[0]?.document?.name;
    if (!name) return json(404, { ok: false, error: `案件番号 ${caseNo} の訪問先が見つかりません` });
    const patch = await fetch(`https://firestore.googleapis.com/v1/${name}?updateMask.fieldPaths=demoUrl&updateMask.fieldPaths=demoUpdatedAt`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${at}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { demoUrl: { stringValue: url }, demoUpdatedAt: { timestampValue: new Date().toISOString() } } })
    });
    if (!patch.ok) throw new Error(`登録に失敗しました（${patch.status}）`);
    return json(200, { ok: true, caseNo, url });
  } catch (e) {
    return json(500, { ok: false, error: e.message });
  }
};

export const config = { path: "/api/demo-url" };
