// DC 完了報告：ホーム画面アプリ用のサービスワーカー
// 画面のファイルは「ネット優先・つながらない時だけ保存版」を使う（更新がすぐ反映されるように）
// 報告データ（Firebase）は保存しない
const CACHE = "dc-report-v20";
const SHELL = [
  "/", "/index.html", "/style.css", "/app.js", "/firebase-config.js",
  "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon.svg", "/icons/apple-touch-icon.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Firebaseなど外部への通信は触らない
  if (url.pathname.startsWith("/api/")) return;    // マップ読み取りなどのAPIは保存しない

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("/index.html")))
  );
});
