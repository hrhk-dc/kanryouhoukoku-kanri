// Firebaseのログイン用ページ（/__/auth/*, /__/firebase/*）を、このサイトの中から配る
// → スマホのChromeでも、別サイトのCookie制限に引っかからずにGoogleログインできる
const FIREBASE_HOST = "https://dc-report-8e1d1.firebaseapp.com";

export async function onRequest({ request }) {
  const u = new URL(request.url);
  if (!/^\/__\/(auth|firebase)\//.test(u.pathname)) return new Response("Not found", { status: 404 });
  // 設定ファイルは Firebase Hosting に無いので、ここで返す（公開してよいウェブ用の設定値）
  if (u.pathname === "/__/firebase/init.json") {
    return new Response(JSON.stringify({
      apiKey: "AIzaSyC7DblMiGT1f5bM9eIVka4xjndbi1cKpOc", authDomain: u.host, projectId: "dc-report-8e1d1",
      storageBucket: "dc-report-8e1d1.firebasestorage.app", messagingSenderId: "380576281192",
      appId: "1:380576281192:web:5b0b60db9f045b85f981dd"
    }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
  const h = new Headers();
  for (const k of ["accept", "accept-language", "user-agent", "content-type"]) {
    const v = request.headers.get(k);
    if (v) h.set(k, v);
  }
  const r = await fetch(FIREBASE_HOST + u.pathname + u.search, {
    method: request.method,
    headers: h,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual"
  });
  const out = new Headers(r.headers);
  out.delete("content-security-policy");
  out.delete("x-frame-options");
  out.set("Cache-Control", "no-store");
  return new Response(r.body, { status: r.status, headers: out });
}
