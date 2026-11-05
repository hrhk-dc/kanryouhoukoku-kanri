import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider, signOut, sendEmailVerification, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, setDoc, collection, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp, writeBatch, runTransaction, getDoc, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { INDUSTRIES, classifyIndustry } from "./industry.js";

/* ---------- 設定 ---------- */
const ADMIN_EMAIL = "hrhk@dc-hm.com";
const MAPS_REGEX = /^https?:\/\/(maps\.app\.goo\.gl\/|goo\.gl\/maps\/|(www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+)/i;
const CLAUDE_TEMPLATE = (url) => `このGoogleマップのリンクからデモサイトを作って：${url}`;

const TYPE_LABELS = {
  text: "テキスト", textarea: "長文", select: "選択式", url: "URL", maps: "GoogleマップURL",
  date: "日付", datetime: "日時", time: "時刻（◯時）", number: "数値", tel: "電話番号",
  caseNo: "案件番号（訪問リストから自動入力）",
  photo: "写真（撮影・アルバムから）"
};
/* 案件番号：A001〜A999 → B001〜B999 → C001… → Z999 → AA001…（連番 n から作る） */
const PER_LETTER = 999;
function letterOf(i) { // 0→A, 25→Z, 26→AA
  let s = "";
  i += 1;
  while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
  return s;
}
const fmtCaseNo = (n) => letterOf(Math.floor((n - 1) / PER_LETTER)) + String(((n - 1) % PER_LETTER) + 1).padStart(3, "0");
/* 案件番号 → 並び替え用の通し番号（A001=1, B001=1000 …。以前の DC-0001 形式にも対応） */
function caseSeq(no) {
  const s = String(no || "").trim().toUpperCase();
  const m = s.match(/^([A-Z]+)(\d{1,3})$/);
  if (m) {
    let idx = 0;
    for (const ch of m[1]) idx = idx * 26 + (ch.charCodeAt(0) - 64);
    return (idx - 1) * PER_LETTER + parseInt(m[2], 10);
  }
  const d = s.match(/^DC-?(\d+)$/);
  return d ? parseInt(d[1], 10) : 0;
}

/* 3種類のフォーマット（管理者が項目を自由に編集できる） */
const FORMATS = {
  report: {
    doc: "reportFormat", title: "完了報告",
    hint: "完了報告の入力項目です。「案件番号」に翌日訪問リストの番号を入れると、訪問先・担当者名・マップなどが自動で入ります（案件番号は固定項目です）。",
    fields: [
      { id: "caseNo", label: "案件番号", type: "caseNo", required: false, locked: true },
      { id: "caseName", label: "案件名", type: "text", required: true },
      { id: "visitTo", label: "訪問先", type: "text", required: true },
      { id: "personName", label: "担当者名", type: "text", required: false },
      { id: "receivedAt", label: "受付日時", type: "datetime", required: false },
      { id: "result", label: "結果", type: "select", required: true, options: ["成約", "検討中", "不在", "断り"] },
      { id: "demoUrl", label: "デモサイトURL", type: "url", required: false },
      { id: "wealth", label: "お客様の資金力（お金のあるなし：1=少ない 〜 10=とても多い）", type: "select", required: false, options: ["1","2","3","4","5","6","7","8","9","10"] },
      { id: "explainTime", label: "説明時間（分）", type: "number", required: false },
      { id: "memo", label: "メモ", type: "textarea", required: false }
    ]
  },
  nextAction: {
    doc: "nextActionFormat", title: "次回アクション",
    hint: "完了報告と一緒に入力する次回アクションの項目です。ほかのフォーマットと同じように、項目の追加・削除・名前変更・種類・必須・並び順を自由に変えられます。",
    fields: [
      { id: "content", label: "内容", type: "textarea", required: true },
      { id: "date", label: "予定日", type: "date", required: false },
      { id: "mapsUrl", label: "GoogleマップのURL", type: "maps", required: true }
    ]
  },
  visit: {
    doc: "visitFormat", title: "翌日訪問リスト",
    hint: "翌日訪問リスト1件分の項目です。訪問日は全件共通で別に入力します。案件番号（A001〜A999、次はB001…）は保存時に自動で付きます。",
    fields: [
      { id: "mapsUrl", label: "GoogleマップのURL", type: "maps", required: false },
      { id: "shopName", label: "店舗名", type: "text", required: true },
      { id: "prefecture", label: "地域（都道府県）", type: "text", required: false, auto: true },
      { id: "city", label: "市（市町村）", type: "text", required: false, auto: true },
      { id: "ward", label: "区", type: "text", required: false, auto: true },
      { id: "category", label: "業種", type: "select", options: INDUSTRIES, required: false, auto: true },
      { id: "hours", label: "営業時間", type: "textarea", required: false, auto: true },
      { id: "address", label: "住所", type: "text", required: false, auto: true },
      { id: "phone", label: "電話番号", type: "tel", required: false, auto: true },
      { id: "rating", label: "Googleの評価", type: "text", required: false, auto: true },
      { id: "website", label: "ホームページ", type: "url", required: false, auto: true },
      { id: "personName", label: "担当者名", type: "text", required: false },
      { id: "visitTime", label: "訪問予定時刻", type: "time", required: false },
      { id: "memo", label: "メモ", type: "textarea", required: false }
    ]
  }
};

/* ---------- 小道具 ---------- */
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clone = (o) => JSON.parse(JSON.stringify(o));
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return ymd(d); };
const fmtHour = (v) => (/^\d{1,2}:/.test(v || "") ? `${parseInt(v, 10)}時` : (v || ""));
const fmtTs = (ts) => (ts && ts.toDate ? ts.toDate().toLocaleString("ja-JP", { dateStyle: "medium", timeStyle: "short" }) : "保存中…");
const fmtDateJa = (s) => {
  if (!s) return "日付なし";
  const [y, m, d] = s.split("-").map(Number);
  const w = "日月火水木金土"[new Date(y, m - 1, d).getDay()];
  return `${y}年${m}月${d}日（${w}）`;
};

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1600);
}

/* ---------- 戻る／進む（削除・変更の取り消しとやり直し） ---------- */
// 履歴はこの画面を開いている間だけ覚えています（再読み込みやログアウトで消えます）
const undoHist = { undo: [], redo: [], busy: false };
const HISTORY_MAX = 30;
// 日時（Timestamp）はそのまま残したいので、JSONを通さず浅くコピーする
const snapDoc = (x) => { const d = { ...x }; delete d.id; delete d.demoUrl; if (d.items) d.items = clone(d.items); if (d.nextActionItems) d.nextActionItems = clone(d.nextActionItems); return d; };
const pickFields = (x, keys) => { const o = {}; keys.forEach((k) => { if (x[k] !== undefined) o[k] = clone(x[k]); }); return o; };
function updateHistoryButtons() {
  const u = $("#undoBtn"), r = $("#redoBtn");
  if (!u || !r) return;
  u.disabled = undoHist.busy || !undoHist.undo.length;
  r.disabled = undoHist.busy || !undoHist.redo.length;
  u.title = undoHist.undo.length ? `元に戻す：${undoHist.undo[undoHist.undo.length - 1].label}` : "直前の削除・変更を元に戻す";
  r.title = undoHist.redo.length ? `やり直す：${undoHist.redo[undoHist.redo.length - 1].label}` : "元に戻した操作をやり直す";
}
function recordHistory(entry) {
  undoHist.undo.push(entry);
  if (undoHist.undo.length > HISTORY_MAX) undoHist.undo.shift();
  undoHist.redo = [];
  updateHistoryButtons();
}
// before / after：その時点のデータ（null は「存在しない」）。更新のときは変わった項目だけ
function historyDelete(col, r, label) { recordHistory({ label, col, id: r.id, before: snapDoc(r), after: null }); }
function historyUpdate(col, r, keys, after, label) {
  recordHistory({ label, col, id: r.id, before: pickFields(r, keys), after: pickFields(after, keys) });
}
async function applyHistory(e, dir) {
  const target = dir === "undo" ? e.before : e.after;
  const other = dir === "undo" ? e.after : e.before;
  const ref = doc(db, e.col, e.id);
  if (target === null) { await deleteDoc(ref); return; }
  if (other === null) { await setDoc(ref, target); return; }
  await updateDoc(ref, { ...clone(target), updatedAt: serverTimestamp(), updatedBy: currentUser.email });
}
async function runHistory(dir) {
  const from = dir === "undo" ? undoHist.undo : undoHist.redo;
  const to = dir === "undo" ? undoHist.redo : undoHist.undo;
  const e = from[from.length - 1];
  if (!e || undoHist.busy) return;
  undoHist.busy = true; updateHistoryButtons();
  try {
    await applyHistory(e, dir);
    from.pop(); to.push(e);
    toast(`${dir === "undo" ? "元に戻しました" : "やり直しました"}：${e.label}`);
  } catch (err) { showBanner(err, dir === "undo" ? "元に戻す" : "やり直し"); }
  undoHist.busy = false; updateHistoryButtons();
}
$("#undoBtn")?.addEventListener("click", () => runHistory("undo"));
$("#redoBtn")?.addEventListener("click", () => runHistory("redo"));
document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
  const k = e.key.toLowerCase();
  if (k === "z" && !e.shiftKey) { e.preventDefault(); runHistory("undo"); }
  else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); runHistory("redo"); }
});

async function copyText(text) {
  if (!text) { toast("コピーする内容がありません"); return; }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  toast("コピーしました");
}

/* コピー用ボタンはどの画面でも data-copy で動く */
document.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-copy]");
  if (btn) copyText(btn.dataset.copy);
});

$("#copyAppLink").addEventListener("click", () => copyText(window.location.origin + "/"));

/* ---------- ホーム画面アプリ（PWA） ---------- */
if ("serviceWorker" in navigator) {
  // 新しい版が公開されたら、開いている画面も自動で最新に切り替える
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").then((reg) => reg.update()).catch(() => {}));
}
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  $("#installBtn").classList.remove("hidden");
});
$("#installBtn").addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $("#installBtn").classList.add("hidden");
});
window.addEventListener("appinstalled", () => $("#installBtn").classList.add("hidden"));

/* ---------- Firebase 初期化 ---------- */
const configured = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("ここに");
if (!configured) {
  $("#configWarning").classList.remove("hidden");
  $("#authView").classList.remove("hidden");
  $("#authForm").querySelectorAll("input, button").forEach((el) => (el.disabled = true));
  $("#googleBtn").disabled = true;
  throw new Error("firebase-config.js が未設定です");
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
const formats = Object.fromEntries(Object.entries(FORMATS).map(([k, v]) => [k, clone(v.fields)]));
const drafts = {};
let adminSection = "report";
let naSectionRequired = true;   // 次回アクションを必須にするか（管理者が切り替え）
let draftNaRequired = true;
let reports = [];
let visits = [];
let editingId = null;
let editingVisitId = null;
let visitRows = [];
let unsubs = [];

/* 利用者の許可制：settings/members に登録されたメールだけが使える（管理者は admins） */
let members = { emails: [], admins: [] };
let membersLoaded = false;
const myEmail = () => (currentUser?.email || "").toLowerCase();
const isOwner = () => !!currentUser && myEmail() === ADMIN_EMAIL && currentUser.emailVerified;
const isAdmin = () => isOwner() || (!!currentUser && currentUser.emailVerified && (members.admins || []).includes(myEmail()));
const isMember = () => isAdmin() || (!!currentUser && currentUser.emailVerified && (members.emails || []).includes(myEmail()));
const canModify = (r) => !!currentUser && (r.authorUid === currentUser.uid || isAdmin());

/* ---------- ログイン ---------- */
let authMode = "login";
document.querySelectorAll(".auth-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    authMode = btn.dataset.mode;
    document.querySelectorAll(".auth-tab").forEach((b) => b.classList.toggle("active", b === btn));
    $("#confirmWrap").classList.toggle("hidden", authMode !== "signup");
    $("#authSubmit").textContent = authMode === "signup" ? "登録する" : "ログイン";
    $("#authPassword").autocomplete = authMode === "signup" ? "new-password" : "current-password";
    clearError($("#authError"));
  });
});

/* ---------- エラーの説明（何が・なぜ・どうすれば） ----------
   エラーコードごとに「原因」と「対処」を日本語で表示し、
   管理者に送れるように「エラー内容をコピー」も付ける */
const ERROR_GUIDE = {
  // ログイン関係
  "auth/invalid-email": ["メールアドレスの形式が正しくありません。", "「@」や「.com」などが抜けていないか、全角文字や空白が入っていないか確認してください。"],
  "auth/missing-password": ["パスワードが入力されていません。", "パスワード欄に入力してから、もう一度押してください。"],
  "auth/invalid-credential": ["メールアドレスかパスワードが違います（または、このメールアドレスは未登録です）。", "入力ミスがないか確認してください。初めての場合は「新規登録」タブから登録します。Googleで登録した人は「Googleでログイン」を使ってください。忘れた場合は「パスワードを忘れた場合」から再設定できます。"],
  "auth/invalid-login-credentials": ["メールアドレスかパスワードが違います。", "入力ミスがないか確認してください。忘れた場合は「パスワードを忘れた場合」から再設定できます。"],
  "auth/wrong-password": ["パスワードが違います。", "大文字・小文字や入力ミスを確認してください。忘れた場合は「パスワードを忘れた場合」から再設定できます。"],
  "auth/user-not-found": ["このメールアドレスはまだ登録されていません。", "「新規登録」タブから登録してください。"],
  "auth/email-already-in-use": ["このメールアドレスはすでに登録されています。", "「ログイン」タブからログインしてください。以前Googleで登録した場合は「Googleでログイン」を使ってください。"],
  "auth/weak-password": ["パスワードが短すぎます。", "6文字以上のパスワードにしてください。"],
  "auth/user-disabled": ["このアカウントは使えないように設定されています。", "管理者（hrhk@dc-hm.com）に連絡してください。"],
  "auth/operation-not-allowed": ["このログイン方法はアプリ側で有効になっていません。", "管理者がFirebaseの「Authentication → ログイン方法」で有効にする必要があります。管理者に連絡してください。"],
  "auth/popup-closed-by-user": ["Googleログインの画面が途中で閉じられました。", "もう一度「Googleでログイン」を押し、アカウントを選ぶところまで進めてください。"],
  "auth/cancelled-popup-request": ["Googleログインが二重に押されたため中断されました。", "少し待ってから、1回だけ「Googleでログイン」を押してください。"],
  "auth/popup-blocked": ["ブラウザがGoogleログインの画面（ポップアップ）をブロックしました。", "ChromeかSafariで開き直してください。または、アドレスバーのブロック表示から「ポップアップを許可」してください。メールアドレスでのログインも使えます。"],
  "auth/operation-not-supported-in-environment": ["このブラウザ（LINEなどのアプリ内ブラウザ）ではGoogleログインが使えません。", "右上のメニューから「ブラウザで開く」を選び、ChromeかSafariで開き直してください。"],
  "auth/web-storage-unsupported": ["このブラウザの設定（シークレットモードやCookie拒否）のせいでログイン情報を保存できません。", "通常モードのChromeかSafariで開き直してください。"],
  "auth/network-request-failed": ["インターネットにつながっていません（電波が弱い・機内モードなど）。", "電波の良い場所やWi-Fiにつないで、もう一度試してください。"],
  "auth/unauthorized-domain": ["このURLのアプリは、ログインの許可リストに入っていません。", "正しいリンク（管理者から届いたもの）で開いているか確認してください。URLが変わった場合は、管理者がFirebaseの「承認済みドメイン」に追加する必要があります。"],
  "auth/too-many-requests": ["短い時間に何度も失敗したため、一時的にロックされています。", "数分〜1時間ほど待ってから試すか、「パスワードを忘れた場合」で再設定してください。"],
  "auth/requires-recent-login": ["ログインしてから時間が経ちすぎています。", "一度ログアウトして、もう一度ログインしてください。"],
  "auth/expired-action-code": ["メールのリンクの有効期限が切れています。", "もう一度、確認メール（またはパスワード再設定メール）を送り直してください。"],
  // データ（保存・読み込み）関係
  "permission-denied": ["この操作をする権限がありません。", "考えられる原因：①ログインが切れている（ログアウトして入り直す）②他の人が作った報告を編集・削除しようとした（本人か管理者だけができます）③フォーマット編集は管理者だけ ④アプリが古い（閉じて開き直す）。それでも出る場合は「エラー内容をコピー」して管理者に送ってください。"],
  "unauthenticated": ["ログインが切れています。", "一度ログアウトして、もう一度ログインしてください。"],
  "unavailable": ["サーバーにつながりません（電波が弱い・オフライン）。", "電波の良い場所で、もう一度保存してください。入力した内容は画面に残っています。"],
  "deadline-exceeded": ["通信に時間がかかりすぎて止まりました。", "電波の良い場所で、もう一度試してください。"],
  "aborted": ["他の人の保存とぶつかったため、やり直しが必要です（案件番号の同時発行など）。", "そのまま、もう一度「保存」を押してください。"],
  "not-found": ["対象のデータが見つかりません（すでに削除された可能性があります）。", "画面を再読み込みして、一覧を確認してください。"],
  "resource-exhausted": ["今日の無料利用枠を使い切ったか、アクセスが多すぎます。", "時間をおいて試してください。続く場合は管理者に連絡してください（Firebaseの料金プランの確認が必要です）。"],
  "failed-precondition": ["データベース側の準備ができていません。", "管理者に「エラー内容をコピー」して送ってください（Firebaseの設定確認が必要です）。"],
  "invalid-argument": ["保存しようとした内容の形式が正しくありません。", "入力内容を確認してください。続く場合は「エラー内容をコピー」して管理者に送ってください。"],
  "cancelled": ["処理が途中でキャンセルされました。", "もう一度試してください。"],
  "internal": ["サーバー側で想定外のエラーが起きました。", "少し待ってから試してください。続く場合は「エラー内容をコピー」して管理者に送ってください。"],
  "unknown": ["原因が特定できないエラーです。", "アプリを閉じて開き直し、もう一度試してください。続く場合は「エラー内容をコピー」して管理者に送ってください。"]
};

function explainError(err) {
  const raw = err?.code || "";
  const code = raw.replace(/^firestore\//, "");
  if (ERROR_GUIDE[code]) return { code: raw, cause: ERROR_GUIDE[code][0], fix: ERROR_GUIDE[code][1] };
  const msg = String(err?.message || err || "");
  if (!navigator.onLine || /network|Failed to fetch|offline/i.test(msg)) {
    return { code: raw || "network", cause: ERROR_GUIDE["unavailable"][0], fix: ERROR_GUIDE["unavailable"][1] };
  }
  if (/Missing or insufficient permissions/i.test(msg)) return { code: "permission-denied", cause: ERROR_GUIDE["permission-denied"][0], fix: ERROR_GUIDE["permission-denied"][1] };
  return { code: raw || "unknown", cause: ERROR_GUIDE.unknown[0], fix: ERROR_GUIDE.unknown[1] };
}

let lastErrorText = "";
function errorReport(err, action) {
  const e = explainError(err);
  return [
    "【DC完了報告 エラー内容】",
    `日時：${new Date().toLocaleString("ja-JP")}`,
    `操作：${action}`,
    `原因：${e.cause}`,
    `エラーコード：${e.code}`,
    `詳細：${String(err?.message || err || "").slice(0, 300)}`,
    `ログイン：${(typeof currentUser !== "undefined" && currentUser?.email) || "未ログイン"}`,
    `画面：${location.href}`,
    `通信：${navigator.onLine ? "オンライン" : "オフライン"}`,
    `端末：${navigator.userAgent}`
  ].join("\n");
}
function errorHtml(err, action) {
  const e = explainError(err);
  lastErrorText = errorReport(err, action);
  return `<div class="err-title">⚠ ${esc(action)}ができませんでした</div>
    <div class="err-row"><b>原因</b>${esc(e.cause)}</div>
    <div class="err-row"><b>対処</b>${esc(e.fix)}</div>
    <div class="err-foot"><span class="err-code">コード：${esc(e.code)}</span>
      <button class="btn small" type="button" data-copy-error>エラー内容をコピー</button></div>`;
}
/* フォームの下にエラーを表示 */
function showError(el, err, action) {
  el.innerHTML = errorHtml(err, action);
  el.classList.add("error-box");
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  console.error(`[${action}]`, err);
}
/* 画面上部にエラーを表示（読み込み・削除など） */
function showBanner(err, action) {
  const b = $("#errorBanner");
  b.innerHTML = errorHtml(err, action) + `<button class="err-close" type="button" aria-label="閉じる">×</button>`;
  b.classList.remove("hidden");
  console.error(`[${action}]`, err);
}
function clearError(el) { el.textContent = ""; el.classList.remove("error-box"); }
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-copy-error]")) copyText(lastErrorText);
  if (e.target.closest(".err-close")) $("#errorBanner").classList.add("hidden");
});
/* 想定外のエラーも見える化する */
window.addEventListener("unhandledrejection", (e) => showBanner(e.reason, "処理"));
window.addEventListener("error", (e) => { if (e.error) showBanner(e.error, "画面の処理"); });
window.addEventListener("offline", () => toast("オフラインになりました。電波が戻るまで保存できません"));
window.addEventListener("online", () => toast("オンラインに戻りました"));

/* ---------- LINEなどアプリ内ブラウザ対策 ----------
   LINE・Instagram・Facebookなどのアプリ内ブラウザでは、Googleの仕様でGoogleログインができない */
const UA = navigator.userAgent || "";
const isLine = / Line\//i.test(UA);
const inAppBrowser = isLine || /FBAN|FBAV|Instagram|Messenger|MicroMessenger|KAKAOTALK|; wv\)/i.test(UA);
if (isLine && !/[?&]openExternalBrowser=1/.test(location.search)) {
  // LINEは openExternalBrowser=1 を付けると標準ブラウザで開き直してくれる
  const u = new URL(location.href);
  u.searchParams.set("openExternalBrowser", "1");
  location.replace(u.toString());
}
if (inAppBrowser) {
  $("#inAppNotice").classList.remove("hidden");
  $("#googleBtn").disabled = true;
  $("#googleBtn").textContent = "Googleでログイン（ChromeかSafariで開くと使えます）";
}
$("#copyLinkForBrowser").addEventListener("click", () => copyText(window.location.origin + "/"));

$("#authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#authEmail").value.trim();
  const pw = $("#authPassword").value;
  clearError($("#authError"));
  try {
    if (authMode === "signup") {
      if (pw !== $("#authPassword2").value) { $("#authError").textContent = "確認用パスワードが一致しません。"; return; }
      const cred = await createUserWithEmailAndPassword(auth, email, pw);
      await sendEmailVerification(cred.user);
      toast("登録しました。確認メールを送りました");
    } else {
      await signInWithEmailAndPassword(auth, email, pw);
    }
  } catch (err) {
    showError($("#authError"), err, authMode === "signup" ? "新規登録" : "ログイン");
  }
});

$("#googleBtn").addEventListener("click", async () => {
  clearError($("#authError"));
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
  try {
    // スマホはポップアップが使えないことが多いので、画面を切り替える方式（リダイレクト）で
    if (mobile) { await signInWithRedirect(auth, provider); return; }
    await signInWithPopup(auth, provider);
  } catch (err) {
    // パソコンでもポップアップが止められたら、リダイレクト方式に切り替える
    if (!mobile && ["auth/popup-blocked", "auth/operation-not-supported-in-environment"].includes(err.code)) {
      try { await signInWithRedirect(auth, provider); return; } catch (e2) { err = e2; }
    }
    showError($("#authError"), err, "Googleログイン");
  }
});
// リダイレクトで戻ってきたときの結果（エラーがあれば表示）
getRedirectResult(auth).catch((err) => showError($("#authError"), err, "Googleログイン"));

$("#resetBtn").addEventListener("click", async () => {
  const email = $("#authEmail").value.trim();
  if (!email) { $("#authError").textContent = "先にメールアドレスを入力してください。"; return; }
  try { await sendPasswordResetEmail(auth, email); toast("再設定メールを送りました"); }
  catch (err) { showError($("#authError"), err, "パスワード再設定メールの送信"); }
});

$("#logoutBtn").addEventListener("click", () => signOut(auth));
$("#resendVerify").addEventListener("click", async () => {
  if (!currentUser) return;
  try { await sendEmailVerification(currentUser); toast("確認メールを再送しました"); }
  catch (err) { showBanner(err, "確認メールの再送"); }
});

let membersUnsub = null;
let dataLoaded = false;
function stopData() { unsubs.forEach((u) => u()); unsubs = []; dataLoaded = false; undoHist.undo = []; undoHist.redo = []; undoHist.busy = false; updateHistoryButtons(); }

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  stopData();
  if (membersUnsub) { membersUnsub(); membersUnsub = null; }
  membersLoaded = false;
  document.body.classList.toggle("logged-in", !!user);
  if (!user) { myName = ""; $("#namePanel").classList.add("hidden"); }

  if (!user) {
    $("#authView").classList.remove("hidden");
    $("#appView").classList.add("hidden");
    $("#pendingView").classList.add("hidden");
    $("#logoutBtn").classList.add("hidden");
    $("#userEmail").textContent = "";
    return;
  }

  $("#authView").classList.add("hidden");
  $("#logoutBtn").classList.remove("hidden");
  $("#userEmail").textContent = user.email;

  const usesPassword = user.providerData.some((p) => p.providerId === "password");
  $("#verifyNotice").classList.toggle("hidden", user.emailVerified || !usesPassword);

  // メンバー一覧を見張り、許可されたら中身を読み込む（許可が外れたら閉じる）
  membersUnsub = onSnapshot(doc(db, "settings", "members"), (snap) => {
    const d = snap.exists() ? snap.data() : {};
    members = { emails: (d.emails || []).map((x) => x.toLowerCase()), admins: (d.admins || []).map((x) => x.toLowerCase()), names: d.names || {} };
    membersLoaded = true;
    applyAccess();
  }, (err) => { showBanner(err, "利用者の確認"); });
});

function applyAccess() {
  const ok = isMember();
  $("#appView").classList.toggle("hidden", !ok);
  $("#pendingView").classList.toggle("hidden", ok);
  $("#userEmail").textContent = currentUser.email + (isAdmin() ? "（管理者）" : "");
  $("#adminTab").classList.toggle("hidden", !isAdmin());
  $("#statsTab").classList.toggle("hidden", !isAdmin());
  if (!isAdmin() && (!$("#tab-admin").classList.contains("hidden") || !$("#tab-stats").classList.contains("hidden"))) showTab("today");
  if (!ok) { stopData(); renderPending(); return; }
  if (!$("#visitDate").value) $("#visitDate").value = tomorrow();
  if (!$("#visitFilterDate").dataset.init) { $("#visitFilterDate").value = tomorrow(); $("#visitFilterDate").dataset.init = "1"; }
  if (!dataLoaded) { dataLoaded = true; subscribe(); }
  if (isAdmin()) renderMembers();
}

/* ---------- データ購読 ---------- */
function subscribe() {
  for (const [key, def] of Object.entries(FORMATS)) {
    unsubs.push(onSnapshot(doc(db, "settings", def.doc), (snap) => {
      const data = snap.exists() ? snap.data() : null;
      formats[key] = data && Array.isArray(data.fields) && data.fields.length ? data.fields : clone(def.fields);
      if (key === "report") { reportPhotoAdded = !!(data && data.photoFieldAdded); reportWealthAdded = !!(data && data.wealthFieldAdded); reportExplainAdded = !!(data && data.explainTimeFieldAdded); }
      normalizeFormat(key);
      if (key === "visit") { visitAutoAdded = !!(data && data.autoFieldsAdded); addAutoVisitFields(); }
      if (key === "nextAction") {
        naSectionRequired = data && typeof data.sectionRequired === "boolean" ? data.sectionRequired : true;
        if (isAdmin()) draftNaRequired = naSectionRequired;
      }
      if (key === "report" || key === "nextAction") { syncCases(); renderReportForm(); }
      if (key === "visit") { if (!editingVisitId) renderVisitRows(); renderVisitList(); }
      if (isAdmin()) { drafts[key] = clone(formats[key]); if (key === adminSection) renderFieldEditor(); }
    }, (err) => showBanner(err, "フォーマットの読み込み")));
  }

  subscribeMe();

  unsubs.push(onSnapshot(query(collection(db, "reports"), orderBy("createdAt", "desc")), (snap) => {
    reports = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderList();
    renderVisitList();
    renderAllExtras();
  }, (err) => showBanner(err, "報告一覧の読み込み")));

  unsubs.push(onSnapshot(query(collection(db, "visits"), orderBy("createdAt", "desc")), (snap) => {
    visits = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    applyDemoUrls();
    renderList();
    renderVisitList();
    renderAllExtras();
  }, (err) => showBanner(err, "訪問リストの読み込み")));

  if (isAdmin()) {
    unsubs.push(onSnapshot(collection(db, "accessRequests"), (snap) => {
      accessRequests = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderMembers();
    }, (err) => showBanner(err, "利用申請の読み込み")));
  }
  restoreDrafts();
  loadDemoUrls();
}

/* フォーマットの整え：
   - 次回アクションは固定項目なし（ほかと同じく自由に編集）
   - 完了報告には「案件番号」欄（固定）を必ず先頭付近に置く */
/* マップから読み取る項目（地域・住所など）を、保存済みの訪問フォーマットにも追加する。
   管理者が一度フォーマットを保存した後（autoFieldsAdded）は、削除した項目を勝手に戻さない */
let visitAutoAdded = false;
function addAutoVisitFields() {
  if (visitAutoAdded) return;
  const have = new Set(formats.visit.map((f) => f.id));
  const autos = FORMATS.visit.fields.filter((f) => f.auto && !have.has(f.id));
  if (!autos.length) return;
  const at = formats.visit.findIndex((f) => f.id === "shopName");
  formats.visit.splice(at >= 0 ? at + 1 : formats.visit.length, 0, ...clone(autos));
  if (!have.has("mapsUrl")) formats.visit.unshift(clone(FORMATS.visit.fields[0]));
}

let reportPhotoAdded = false;
let reportWealthAdded = false;
let reportExplainAdded = false;
/* 説明時間の項目（項目名に「説明時間」を含むもの）。値は「分」 */
const explainItemOf = (items) => (items || []).find((i) => (i.id === "explainTime" || /説明時間/.test(i.label || "")) && i.value);
function normalizeFormat(key) {
  if (key === "report") { // 「資力」は「資金力」に名前を変更
    formats.report.forEach((f) => { if (f.id === "wealth" && /資力/.test(f.label || "")) f.label = f.label.replace(/資力/g, "資金力"); });
  }
  if (key === "report" && !reportExplainAdded && !formats.report.some((f) => f.id === "explainTime" || /説明時間/.test(f.label || ""))) {
    const at = formats.report.findIndex((f) => f.id === "wealth");
    formats.report.splice(at >= 0 ? at + 1 : formats.report.length, 0, clone(FORMATS.report.fields.find((f) => f.id === "explainTime")));
  }
  if (key === "visit") { // 業種は「飲食店・美容院…」から選ぶ形に
    const c = formats.visit.find((f) => f.id === "category" || /^業種$/.test(f.label || ""));
    if (c) { c.type = "select"; c.options = [...INDUSTRIES]; }
  }
  if (key === "nextAction") formats.nextAction.forEach((f) => delete f.locked);
  if (key === "report" && !reportPhotoAdded && !formats.report.some((f) => f.type === "photo")) {
    formats.report.push({ id: "photos", label: "写真", type: "photo", required: false });
  }
  if (key === "report" && !reportWealthAdded && !formats.report.some((f) => f.id === "wealth")) {
    const at = formats.report.findIndex((f) => f.id === "result");
    formats.report.splice(at >= 0 ? at + 1 : formats.report.length, 0, clone(FORMATS.report.fields.find((f) => f.id === "wealth")));
  }
  if (key === "report") {
    const f = formats.report.find((x) => x.type === "caseNo" || x.id === "caseNo");
    if (!f) formats.report.unshift(clone(FORMATS.report.fields[0]));
    else Object.assign(f, { type: "caseNo", locked: true });
  }
}

/* ---------- 自分の名前（担当者名の自動入力） ---------- */
let myName = "";
let myOrder = []; // 訪問リストの「手動の並び順」（自分用）
function subscribeMe() {
  unsubs.push(onSnapshot(doc(db, "users", currentUser.uid), (snap) => {
    myName = (snap.exists() && snap.data().name) || "";
    myOrder = (snap.exists() && Array.isArray(snap.data().visitOrder)) ? snap.data().visitOrder : [];
    $("#myNameLabel").textContent = myName ? `👤 ${myName}` : "👤 名前を設定";
    renderVisitList();
    renderList();
    renderAllExtras();
    // 開いている入力欄で、まだ何も書いていない担当者名に反映
    document.querySelectorAll('[data-field-id="personName"]').forEach((el) => { if (!el.value && myName) el.value = myName; });
    document.querySelectorAll("input[data-fix-name]").forEach((cb) => {
      const v = cb.closest(".person-wrap")?.querySelector("input[data-field-id]")?.value.trim();
      cb.checked = !!myName && v === myName;
    });
  }));
}
async function saveMyName(name) {
  await setDoc(doc(db, "users", currentUser.uid), { name, email: currentUser.email, updatedAt: serverTimestamp() }, { merge: true });
}
$("#myNameLabel").addEventListener("click", () => {
  $("#namePanel").classList.toggle("hidden");
  $("#myNameInput").value = myName;
  $("#myNameInput").focus();
});
$("#saveMyName").addEventListener("click", async () => {
  try {
    await saveMyName($("#myNameInput").value.trim());
    $("#namePanel").classList.add("hidden");
    toast($("#myNameInput").value.trim() ? "名前を固定しました（次回から自動入力）" : "名前の固定を外しました");
  } catch (err) { showBanner(err, "名前の保存"); }
});
$("#cancelMyName").addEventListener("click", () => $("#namePanel").classList.add("hidden"));
document.addEventListener("change", async (e) => {
  const cb = e.target.closest("input[data-fix-name]");
  if (!cb) return;
  const v = cb.closest(".person-wrap")?.querySelector("input[data-field-id]")?.value.trim() || "";
  if (cb.checked && !v) { cb.checked = false; toast("先に担当者名を入力してください"); return; }
  try {
    await saveMyName(cb.checked ? v : "");
    toast(cb.checked ? `「${v}」を固定しました（次回から自動入力）` : "名前の固定を外しました");
  } catch (err) { showBanner(err, "名前の保存"); }
});

/* ---------- タブ ---------- */
function showTab(name) {
  if ((name === "stats" || name === "admin") && !isAdmin()) name = "today"; // 集計・管理は管理者のみ
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  ["today", "list", "form", "visits", "stats", "admin"].forEach((n) => $(`#tab-${n}`)?.classList.toggle("hidden", n !== name));
  if (name === "today") renderToday();
  if (name === "stats") renderStats();
  window.scrollTo(0, 0);
}
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
  if ((t.dataset.tab === "admin" || t.dataset.tab === "stats") && !isAdmin()) return;
  showTab(t.dataset.tab);
}));

/* ---------- 項目の入力欄・表示・チェック（共通） ---------- */
function fieldInput(f, value = "") {
  const attrs = `data-field-id="${esc(f.id)}"${f.required ? " required" : ""}`;
  switch (f.type) {
    case "textarea": return `<textarea ${attrs} rows="3">${esc(value)}</textarea>`;
    case "select": {
      const list = (f.options || []).slice();
      if (value && !list.includes(value)) list.push(value); // 以前に入れた値も消えないように残す
      const opts = list.map((o) => `<option value="${esc(o)}"${o === value ? " selected" : ""}>${esc(o)}</option>`).join("");
      return `<select ${attrs}><option value="">選択してください</option>${opts}</select>`;
    }
    case "url": return `<input type="url" ${attrs} placeholder="https://..." value="${esc(value)}">`;
    case "maps": return `<input type="url" ${attrs} placeholder="https://maps.app.goo.gl/..." value="${esc(value)}">
      <div class="btn-row">
        <button class="btn small" type="button" data-copy-field="url">URLをコピー</button>
        <button class="btn small" type="button" data-copy-field="claude">Claude Code用の指示をコピー</button>
      </div>`;
    case "date": return `<input type="date" ${attrs} value="${esc(value)}">`;
    case "datetime": return `<input type="datetime-local" ${attrs} value="${esc(value)}">`;
    case "time": {
      // 時刻は「◯時」だけで選ぶ（分は使わない）。値は並び替えのため "09:00" の形で保存
      const cur = value ? `${String(value).slice(0, 2)}:00` : "";
      const opts = Array.from({ length: 24 }, (_, h) => {
        const v = `${pad(h)}:00`;
        return `<option value="${v}"${v === cur ? " selected" : ""}>${h}時</option>`;
      }).join("");
      return `<select ${attrs}><option value="">選択してください</option>${opts}</select>`;
    }
    case "number": return `<input type="number" ${attrs} value="${esc(value)}">`;
    case "tel": return `<input type="tel" ${attrs} value="${esc(value)}">`;
    case "caseNo": return `<input type="text" ${attrs} list="caseNoList" placeholder="例：A001（訪問リストの番号）" value="${esc(value)}" autocomplete="off">
      <span class="case-hit hint"></span>`;
    case "photo": {
      const ids = String(value || "").split(",").filter(Boolean);
      return `<span class="photo-field"><input type="hidden" ${attrs} value="${esc(ids.join(","))}">
        <span class="ph-list">${photoThumbs(ids, true)}</span>
        <span class="btn small ph-add">📷 写真を追加<input type="file" accept="image/*" multiple data-photo-input></span>
        <span class="ph-status hint"></span></span>`;
    }
    default: return `<input type="text" ${attrs} value="${esc(value)}">`;
  }
}

function fieldsHtml(fields, values = {}, autoIds = null) {
  return fields.map((f) => {
    let v = values[f.id];
    // 担当者名：まだ何も入れていない新しい欄には、固定した自分の名前を入れておく
    if (f.id === "personName" && v === undefined) v = myName;
    v = v ?? "";
    const fix = f.id === "personName" ? `
      <label class="check fix-name"><input type="checkbox" data-fix-name${myName && v === myName ? " checked" : ""}> この名前を自分の名前として固定する（次回から自動入力・あとで変更できます）</label>` : "";
    const auto = autoIds && autoIds(f) ? '<span class="auto-tag">自動入力</span>' : "";
    return `<div class="${f.id === "personName" ? "person-wrap" : "field-wrap"}"><label>${esc(f.label)} ${f.required ? '<span class="req">必須</span>' : ""}${auto}
      ${fieldInput(f, v)}
    </label>${fix}</div>`;
  }).join("");
}

/* 案件番号を入れたら、翌日訪問リストの情報で空欄を自動入力 */
const norm = (s) => String(s || "").trim().toUpperCase().replace(/[－ー−]/g, "-").replace(/[０-９Ａ-Ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
function fillFromCaseNo(input) {
  const card = input.closest(".case-card");
  const hit = input.parentElement.querySelector(".case-hit");
  const key = norm(input.value);
  const v = key && visits.find((x) => norm(x.caseNo) === key);
  if (!v) { if (hit) hit.textContent = key ? "この番号の訪問先は見つかりません" : ""; return; }
  if (input.value !== v.caseNo) input.value = v.caseNo;
  const src = v.items || [];
  const byId = Object.fromEntries(src.map((i) => [i.id, i.value]));
  const byLabel = Object.fromEntries(src.map((i) => [i.label, i.value]));
  const shop = byId.shopName || src.find((i) => i.type === "text" && i.value)?.value || "";
  const extra = { visitTo: shop, caseName: shop, demoUrl: v.demoUrl || "" };
  let filled = 0;
  const put = (el, val) => { if (el && !el.value && val) { el.value = val; filled++; } };
  card?.querySelectorAll(".case-fields [data-field-id]").forEach((el) => {
    const id = el.dataset.fieldId;
    if (id === "caseNo") return;
    const label = formats.report.find((f) => f.id === id)?.label;
    put(el, byId[id] ?? byLabel[label] ?? extra[id]);
  });
  // 次回アクションのGoogleマップ欄にも訪問先のマップを入れる
  const maps = src.find((i) => i.type === "maps" && i.value)?.value;
  card?.querySelectorAll(".case-na [data-field-id]").forEach((el) => {
    const f = formats.nextAction.find((x) => x.id === el.dataset.fieldId);
    if (f?.type === "maps") put(el, maps);
  });
  if (hit) hit.textContent = `✓ ${fmtDateJa(v.visitDate)}訪問予定「${shop}」の情報を${filled ? `${filled}項目入れました` : "確認しました（空欄はありません）"}`;
}
document.addEventListener("change", (e) => {
  const el = e.target.closest('#reportCases [data-field-id]');
  if (el && formats.report.find((f) => f.id === el.dataset.fieldId)?.type === "caseNo") fillFromCaseNo(el);
});
document.addEventListener("input", (e) => {
  const el = e.target.closest('#reportCases [data-field-id]');
  if (!el || formats.report.find((f) => f.id === el.dataset.fieldId)?.type !== "caseNo") return;
  if (visits.some((x) => norm(x.caseNo) === norm(el.value))) fillFromCaseNo(el);
});

/* 入力欄の中の「URLをコピー」「Claude Code用の指示をコピー」 */
document.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-copy-field]");
  if (!btn) return;
  const url = (btn.closest("label")?.querySelector("input")?.value || "").trim();
  if (!url) { toast("GoogleマップのURLを入力してください"); return; }
  copyText(btn.dataset.copyField === "claude" ? CLAUDE_TEMPLATE(url) : url);
});

function collectItems(container, fields) {
  return fields.map((f) => ({
    id: f.id, label: f.label, type: f.type,
    value: (container.querySelector(`[data-field-id="${CSS.escape(f.id)}"]`)?.value || "").trim()
  }));
}

function validateItems(fields, items, prefix = "") {
  for (const f of fields) {
    const v = items.find((i) => i.id === f.id)?.value || "";
    if (f.required && !v) return `${prefix}「${f.label}」を入力してください。`;
    if (f.type === "url" && v && !/^https?:\/\//i.test(v)) return `${prefix}「${f.label}」は https:// から始まるURLを入力してください。`;
    if (f.type === "maps" && v && !MAPS_REGEX.test(v)) return `${prefix}「${f.label}」はGoogleマップのURL（maps.app.goo.gl または google.com/maps）を貼り付けてください。`;
  }
  return "";
}

function valueHtml(i) {
  if (i.type === "url") {
    const label = i.id === "demoUrl" ? "デモサイトを開く" : "開く";
    return `<a href="${esc(i.value)}" target="_blank" rel="noopener">${esc(i.value)}</a>
      <div class="btn-row">
        <a class="btn small" href="${esc(i.value)}" target="_blank" rel="noopener">${label}</a>
        <button class="btn small" type="button" data-copy="${esc(i.value)}">URLをコピー</button>
      </div>`;
  }
  if (i.type === "maps") {
    return `<a href="${esc(i.value)}" target="_blank" rel="noopener">${esc(i.value)}</a>
      <div class="btn-row">
        <button class="btn small" type="button" data-copy="${esc(i.value)}">URLをコピー</button>
        <button class="btn small" type="button" data-copy="${esc(CLAUDE_TEMPLATE(i.value))}">Claude Code用の指示をコピー</button>
      </div>`;
  }
  if (i.type === "photo") return `<span class="ph-list">${photoThumbs(String(i.value).split(","))}</span>`;
  if (i.type === "datetime") return esc(i.value.replace("T", " "));
  if (i.type === "time") return esc(fmtHour(i.value));
  return esc(i.value);
}

const itemsDl = (items) => {
  const filled = items.filter((i) => i.value);
  return filled.length ? `<dl class="report-items">${filled.map((i) => `<dt>${esc(i.label)}</dt><dd>${valueHtml(i)}</dd>`).join("")}</dl>` : "";
};

/* ---------- 完了報告フォーム ---------- */
/* 1回の完了報告に複数の案件を入れられる（作成者が「＋ 別の案件を追加」で増やす）。
   保存時は案件ごとに1件の報告として登録する */
let reportCases = [{ v: {}, na: {} }];

function syncCases() {
  const cards = document.querySelectorAll("#reportCases .case-card");
  if (!cards.length) return;
  reportCases = [...cards].map((c) => ({
    v: toValues(collectItems(c.querySelector(".case-fields"), formats.report)),
    na: toValues(collectItems(c.querySelector(".case-na"), formats.nextAction))
  }));
}

function renderReportForm() {
  if (!reportCases.length) reportCases = [{ v: {}, na: {} }];
  const many = reportCases.length > 1;
  const tag = naSectionRequired ? `<span class="req">必須</span>` : `<span class="opt">任意</span>`;
  $("#reportCases").innerHTML = reportCases.map((c, idx) => `
    <div class="case-card${many ? " multi" : ""}" data-case="${idx}">
      ${many ? `<div class="row-card-head"><span>案件 ${idx + 1}</span>
        <button class="btn small danger" type="button" data-remove-case="${idx}">この案件を削除</button></div>` : ""}
      <div class="case-fields">${fieldsHtml(formats.report, c.v)}</div>
      <fieldset class="next-action">
        <legend>次回アクション ${tag}</legend>
        <div class="case-na">${fieldsHtml(formats.nextAction, c.na)}</div>
      </fieldset>
    </div>`).join("");
  $("#addCase").classList.toggle("hidden", !!editingId);
  $("#caseHint").classList.toggle("hidden", !!editingId);
  $("#saveReport").textContent = editingId ? "更新する" : (many ? `${reportCases.length}件まとめて保存` : "保存する");
}

$("#addCase").addEventListener("click", () => {
  syncCases();
  reportCases.push({ v: {}, na: {} });
  renderReportForm();
  const cards = document.querySelectorAll("#reportCases .case-card");
  cards[cards.length - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
});

$("#reportCases").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-remove-case]");
  if (!btn) return;
  syncCases();
  reportCases.splice(Number(btn.dataset.removeCase), 1);
  renderReportForm();
});

function resetForm() {
  editingId = null;
  reportCases = [{ v: {}, na: {} }];
  $("#formTitle").textContent = "完了報告";
  $("#cancelEdit").classList.add("hidden");
  clearError($("#formError"));
  renderReportForm();
}

$("#cancelEdit").addEventListener("click", () => { resetForm(); showTab("list"); });

$("#reportForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = $("#formError");
  clearError(errEl);

  const cards = [...document.querySelectorAll("#reportCases .case-card")];
  let cases = cards.map((c) => ({
    items: collectItems(c.querySelector(".case-fields"), formats.report),
    nextActionItems: collectItems(c.querySelector(".case-na"), formats.nextAction)
  }));
  const many = cases.length > 1;
  // 複数案件のとき、何も入力していない案件は保存しない
  const isBlank = (c) => !c.items.some((i) => i.value) && !c.nextActionItems.some((i) => i.value);
  const numbered = cases.map((c, i) => ({ ...c, no: i + 1 }));
  const targets = many ? numbered.filter((c) => !isBlank(c)) : numbered;
  if (!targets.length) { errEl.textContent = "案件を1件以上入力してください。"; return; }

  for (const c of targets) {
    const pre = many ? `案件${c.no}の` : "";
    const naFilled = c.nextActionItems.some((i) => i.value);
    // 次回アクションが「任意」で何も入力していなければ、次回アクションのチェックは省く
    const err = validateItems(formats.report, c.items, pre) ||
      ((naSectionRequired || naFilled) ? validateItems(formats.nextAction, c.nextActionItems, `${pre}次回アクションの`) : "");
    if (err) { errEl.textContent = err; return; }
    if (naSectionRequired && !naFilled) { errEl.textContent = `${pre}次回アクションを入力してください。`; return; }
  }

  $("#saveReport").disabled = true;
  try {
    if (editingId) {
      const c = targets[0];
      const prevR = reports.find((x) => x.id === editingId);
      await updateDoc(doc(db, "reports", editingId), {
        items: c.items, nextActionItems: c.nextActionItems,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser.email
      });
      if (prevR) historyUpdate("reports", prevR, ["items", "nextActionItems"], c, "報告の編集");
      toast("更新しました");
    } else {
      const batch = writeBatch(db);
      targets.forEach((c) => {
        batch.set(doc(collection(db, "reports")), {
          items: c.items, nextActionItems: c.nextActionItems,
          authorUid: currentUser.uid,
          authorEmail: currentUser.email,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      });
      await batch.commit();
      toast(targets.length > 1 ? `${targets.length}件の案件を保存しました` : "保存しました");
      store.del("report");
    }
    resetForm();
    showTab("list");
  } catch (err2) {
    showError(errEl, err2, editingId ? "完了報告の更新" : "完了報告の保存");
  } finally {
    $("#saveReport").disabled = false;
  }
});

/* 以前の形式（nextAction）で保存された報告も表示・編集できるようにする */
function naItemsOf(r) {
  if (Array.isArray(r.nextActionItems)) return r.nextActionItems;
  const na = r.nextAction || {};
  return [
    { id: "content", label: "内容", type: "textarea", value: na.content || "" },
    { id: "date", label: "予定日", type: "date", value: na.date || "" },
    { id: "mapsUrl", label: "GoogleマップのURL", type: "maps", value: na.mapsUrl || "" }
  ];
}

const toValues = (items) => Object.fromEntries((items || []).map((i) => [i.id, i.value]));

function startEdit(r) {
  editingId = r.id;
  reportCases = [{ v: toValues(r.items), na: toValues(naItemsOf(r)) }];
  renderReportForm();
  $("#formTitle").textContent = "完了報告を編集";
  $("#cancelEdit").classList.remove("hidden");
  clearError($("#formError"));
  showTab("form");
}

/* ---------- 報告一覧 ---------- */
const itemVal = (items, id) => (items || []).find((i) => i.id === id)?.value || "";
const firstOfType = (items, types) => (items || []).find((i) => types.includes(i.type) && i.value)?.value || "";
const tsNum = (ts) => (ts && ts.toMillis ? ts.toMillis() : Date.now() + 1e12); // 保存中は一番新しい扱い
const RESULT_CLASS = { "成約": "ok", "検討中": "wait", "不在": "gray", "断り": "ng" };
const today = () => ymd(new Date());

["#searchInput", "#sortSelect", "#resultFilter", "#authorFilter"].forEach((s) =>
  $(s).addEventListener(s === "#searchInput" ? "input" : "change", renderList));
$("#clearFilters").addEventListener("click", () => {
  $("#searchInput").value = ""; $("#sortSelect").value = "new";
  $("#resultFilter").value = ""; $("#authorFilter").value = "";
  renderList();
});

function refreshResultOptions() {
  const sel = $("#resultFilter");
  const cur = sel.value;
  const fromFormat = formats.report.find((f) => f.id === "result")?.options || [];
  const fromData = reports.map((r) => itemVal(r.items, "result")).filter(Boolean);
  const all = [...new Set([...fromFormat, ...fromData])];
  sel.innerHTML = `<option value="">すべて</option>` + all.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("");
  sel.value = all.includes(cur) ? cur : "";
}

const SORTERS = {
  new: (a, b) => tsNum(b.createdAt) - tsNum(a.createdAt),
  old: (a, b) => tsNum(a.createdAt) - tsNum(b.createdAt),
  received: (a, b) => byEmptyLast(firstOfType(b.items, ["datetime"]), firstOfType(a.items, ["datetime"])),
  nextDate: (a, b) => byEmptyLast(firstOfType(naItemsOf(a), ["date", "datetime"]), firstOfType(naItemsOf(b), ["date", "datetime"])),
  caseName: (a, b) => byEmptyLast(reportTitle(a), reportTitle(b), true)
};
function byEmptyLast(x, y, ja = false) {
  if (!x && !y) return 0;
  if (!x) return 1;
  if (!y) return -1;
  return ja ? x.localeCompare(y, "ja") : x.localeCompare(y);
}

/* 報告の担当者名（「担当者」を含む項目）。なければ入力者のメール */
const reportPerson = (r) => itemVal(r.items, "personName") || (r.items || []).find((i) => /担当/.test(i.label || "") && i.value)?.value || "";
const isMyReport = (r) => (myName ? reportPerson(r) === myName : false) || r.authorUid === currentUser?.uid;
function refreshReportPersonOptions() {
  const sel = $("#authorFilter");
  const cur = sel.value;
  const names = [...new Set(reports.map(reportPerson).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
  sel.innerHTML = `<option value="">全員</option><option value="me">自分${myName ? `（${esc(myName)}）` : ""}</option>` +
    names.filter((n) => n !== myName).map((n) => `<option value="p:${esc(n)}">${esc(n)}</option>`).join("");
  sel.value = [...sel.options].some((o) => o.value === cur) ? cur : "";
}

function renderList() {
  refreshResultOptions();
  refreshReportPersonOptions();
  const q = $("#searchInput").value.trim().toLowerCase();
  const resF = $("#resultFilter").value;
  const authF = $("#authorFilter").value;
  const sort = $("#sortSelect").value;

  const list = reports.filter((r) => {
    if (resF && itemVal(r.items, "result") !== resF) return false;
    if (authF === "me" && !isMyReport(r)) return false;
    if (authF.startsWith("p:") && reportPerson(r) !== authF.slice(2)) return false;
    if (!q) return true;
    const text = [...(r.items || []), ...naItemsOf(r)].map((i) => i.value).concat(r.authorEmail || "").join(" ").toLowerCase();
    return q.split(/\s+/).every((w) => text.includes(w));
  }).sort(SORTERS[sort] || SORTERS.new);

  const filtered = q || resF || authF;
  // 絞り込み中の結果ごとの件数（成約◯件・検討中◯件…）も出す
  const byResult = {};
  list.forEach((r) => { const k = itemVal(r.items, "result") || "未入力"; byResult[k] = (byResult[k] || 0) + 1; });
  const won = byResult["成約"] || 0;
  const rate = list.length ? Math.round((won / list.length) * 100) : 0;
  const breakdown = Object.entries(byResult).filter(([k]) => k !== "成約").map(([k, c]) => `${esc(k)} ${c}件`).join("・");
  const who = authF === "me" ? "自分" : authF.startsWith("p:") ? `${authF.slice(2)}さん` : "";
  $("#listCount").innerHTML = `<span class="lc-total">${who ? `${esc(who)}：` : ""}${filtered ? `${list.length}件（全${reports.length}件中）` : `全${reports.length}件`}</span>` +
    (list.length ? `<span class="lc-won">🎉 成約 <b>${won}件</b>（成約率 ${rate}%）</span>` : "") +
    (breakdown ? `<span class="lc-rest">${breakdown}</span>` : "");
  $("#clearFilters").classList.toggle("hidden", !filtered && sort === "new");

  if (!list.length) {
    $("#reportList").innerHTML = `<p class="empty">${filtered ? "条件に合う報告がありません" : "まだ報告がありません"}</p>`;
    return;
  }

  $("#reportList").innerHTML = list.map((r) => {
    const title = reportTitle(r);
    const result = itemVal(r.items, "result");
    const caseNo = firstOfType(r.items, ["caseNo"]);
    const subs = [
      caseNo && `<span class="case-no">${esc(caseNo)}</span>`,
      (() => { const v = visitOfReport(r); const ad = v ? addressOf(v) : ""; return ad && `🏠 ${esc(ad)}`; })(),
      itemVal(r.items, "visitTo") && itemVal(r.items, "visitTo") !== title && `📍 ${esc(itemVal(r.items, "visitTo"))}`,
      itemVal(r.items, "wealth") && `💰 資金力 ${esc(itemVal(r.items, "wealth"))}/10`,
      (() => { const e = explainItemOf(r.items); return e && `⏱ 説明時間 ${esc(e.value)}${/^\d+(\.\d+)?$/.test(String(e.value).trim()) ? "分" : ""}`; })(),
      itemVal(r.items, "personName") && `👤 ${esc(itemVal(r.items, "personName"))}`,
      firstOfType(r.items, ["datetime"]) && `🕒 受付 ${esc(firstOfType(r.items, ["datetime"]).replace("T", " "))}`
    ].filter(Boolean);
    const shown = ["caseNo", "caseName", "result", "visitTo", "personName", "wealth", "explainTime"];
    const explainItem = explainItemOf(r.items);
    const rest = (r.items || []).filter((i) => !shown.includes(i.id) && i !== explainItem);
    // 店舗名の隣に業種（訪問リストの案件番号からたどる）
    const industry = (() => { const v = visitOfReport(r); return v ? industryOf(v) : ""; })();

    const na = naItemsOf(r);
    const naDate = firstOfType(na, ["date", "datetime"]).slice(0, 10);
    const naText = firstOfType(na, ["textarea", "text"]);
    const naMaps = firstOfType(na, ["maps"]);
    let due = "";
    if (naDate) {
      if (naDate < today()) due = `<span class="due over">期限切れ</span>`;
      else if (naDate === today()) due = `<span class="due now">今日</span>`;
    }
    const naHtml = (naDate || naText || naMaps) ? `
      <div class="na-box">
        <div class="na-line"><strong>次回</strong>${naDate ? `<span>${esc(fmtDateJa(naDate))}</span>` : ""}${due}</div>
        ${naText ? `<div class="na-text">${esc(naText)}</div>` : ""}
        ${naMaps ? `<div class="btn-row">
          <a class="btn small" href="${esc(naMaps)}" target="_blank" rel="noopener">地図を開く</a>
          <button class="btn small" type="button" data-copy="${esc(naMaps)}">URLをコピー</button>
          <button class="btn small" type="button" data-copy="${esc(CLAUDE_TEMPLATE(naMaps))}">Claude Code用の指示をコピー</button>
        </div>` : ""}
      </div>` : "";

    const actions = canModify(r) ? `
      <span class="btn-row" style="margin:0">
        <button class="btn small" type="button" data-edit="${esc(r.id)}">編集</button>
        <button class="btn small danger" type="button" data-del="${esc(r.id)}">削除</button>
      </span>` : "";

    const demoUrl = itemVal(r.items, "demoUrl") || (() => { const v = visitOfReport(r); return v ? (v.demoUrl || itemVal(v.items, "demoUrl")) : ""; })();
    const demoHtml = demoUrl ? `<div class="btn-row">${demoLinksHtml(demoUrl)}</div>` : "";
    const details = itemsDl(rest) + (na.some((i) => i.value) ? `<p class="details-sub">次回アクション</p>${itemsDl(na)}` : "");

    return `<article class="card report-card">
      <div class="report-head">
        <p class="report-title">${esc(title)}${industry ? ` <span class="tag cat">${esc(industry)}</span>` : ""}</p>
        ${result ? `<span class="badge ${RESULT_CLASS[result] || ""}">${esc(result)}</span>` : ""}
      </div>
      ${subs.length ? `<p class="report-sub">${subs.join("<span class=\"sep\">·</span>")}</p>` : ""}
      ${demoHtml}
      ${naHtml}
      ${details ? `<details class="report-details"><summary>詳細を表示</summary>${details}</details>` : ""}
      <div class="report-foot">
        <span>${esc(r.authorEmail)}・${fmtTs(r.createdAt)}</span>
        ${actions}
      </div>
    </article>`;
  }).join("");
}

$("#reportList").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-edit], button[data-del]");
  if (!btn) return;
  const r = reports.find((x) => x.id === (btn.dataset.edit || btn.dataset.del));
  if (!r || !canModify(r)) return;
  if (btn.dataset.edit) startEdit(r);
  if (btn.dataset.del) {
    if (!confirm(`「${reportTitle(r)}」を削除しますか？（上の「戻る」で元に戻せます）`)) return;
    try { await deleteDoc(doc(db, "reports", r.id)); historyDelete("reports", r, `報告「${reportTitle(r)}」の削除`); toast("削除しました（「戻る」で復元できます）"); }
    catch (err) { showBanner(err, "削除"); }
  }
});

/* ---------- 翌日訪問リスト：入力 ---------- */
function syncVisitRows() {
  visitRows = [...document.querySelectorAll("#visitRows .row-card")].map((row) =>
    toValues(collectItems(row, formats.visit)));
}

/* 項目名から「マップから自動で入れる項目か」を判断（管理者が追加した項目にも対応） */
function autoKeyByLabel(label = "", type = "") {
  if (/^区$/.test(label)) return "ward";
  if (/都道府県/.test(label)) return "prefecture";
  if (/^市/.test(label)) return "city";
  if (/県|市|区|地域|エリア/.test(label)) return "area";
  if (/住所|所在地/.test(label)) return "address";
  if (/電話|TEL/i.test(label)) return "phone";
  if (/営業時間/.test(label)) return "hours";
  if (/業種|ジャンル|カテゴリ/.test(label)) return "category";
  if (/評価|口コミ/.test(label)) return "rating";
  if (/ホームページ|HP|サイト/i.test(label) && type === "url") return "website";
  if (/店舗名|店名|訪問先/.test(label)) return "name";
  return null;
}
const isAutoField = (f) => f.type !== "maps" && !!(f.auto || LOOKUP_MAP[f.id] || autoKeyByLabel(f.label, f.type));

/* 入力するのはGoogleマップのリンクだけ。
   ほかの項目は自動入力され、カードの「確認・修正」を開けばいつでも直せる */
function renderVisitRows() {
  if (editingVisitId && !visitRows.length) visitRows = [{}];
  const linkFields = formats.visit.filter((f) => f.type === "maps");
  const timeFields = formats.visit.filter((f) => f.type === "time"); // 訪問予定時刻は見える場所に出す
  const otherFields = formats.visit.filter((f) => f.type !== "maps" && f.type !== "time");
  $("#visitRows").innerHTML = visitRows.length ? visitRows.map((vals, idx) => `
    <div class="row-card" data-row="${idx}">
      <div class="row-card-head">
        <span class="row-no">${editingVisitId ? `${esc(visits.find((x) => x.id === editingVisitId)?.caseNo || "訪問先")} を編集` : `${idx + 1}件目<span class="hint">（保存すると案件番号が付きます）</span>`}</span>
        ${editingVisitId ? "" : `<button class="btn small danger" type="button" data-remove-row="${idx}">この件を削除</button>`}
      </div>
      ${fieldsHtml(linkFields, vals)}
      ${timeFields.length ? `<div class="row-when">${fieldsHtml(timeFields, vals)}</div>` : ""}
      <div class="row-summary"></div>
      <div class="btn-row" style="margin:4px 0"><button class="btn small" type="button" data-relookup="${idx}">🔄 マップから読み取り直す（店舗名・県・市・区・業種・営業時間を上書き）</button></div>
      <details class="row-more"${editingVisitId || !linkFields.length ? " open" : ""}>
        <summary>読み取った内容を確認・修正（店舗名・都道府県・市・区・業種・営業時間など）</summary>
        ${fieldsHtml(otherFields, vals, isAutoField)}
      </details>
    </div>`).join("") : `<p class="rows-empty">上にGoogleマップのリンクを貼ると、ここに1件ずつカードができます</p>`;
  document.querySelectorAll("#visitRows .row-card").forEach((r) => updateRowSummary(r));
  $("#addVisitRow").classList.toggle("hidden", !!editingVisitId);
  $("#bulkBox").classList.toggle("hidden", !!editingVisitId);
  $("#saveVisits").textContent = editingVisitId ? "更新する" : (visitRows.length > 1 ? `${visitRows.length}件まとめて保存` : "保存する");
}
$("#visitRows").addEventListener("input", (e) => {
  const row = e.target.closest(".row-card");
  if (row) updateRowSummary(row);
});

/* リンクを行（カード）にする：1リンク＝1件。同じリンクの二重登録はしない */
const MAPS_URL_RE = /https?:\/\/[^\s<>"'、。）)]+/g;
const splitLinks = (text) => [...new Set((String(text).match(MAPS_URL_RE) || []).filter((u) => MAPS_REGEX.test(u)))];
async function addLinksAsRows(links, replaceRowEl = null) {
  const mapsField = formats.visit.find((f) => f.type === "maps");
  if (!mapsField) { toast("訪問リストのフォーマットにGoogleマップURLの項目がありません"); return; }
  syncVisitRows();
  const replaceIdx = replaceRowEl ? Number(replaceRowEl.dataset.row) : -1;
  const existing = new Set(visitRows.map((v) => (v[mapsField.id] || "").trim()).filter(Boolean));
  const fresh = links.filter((u) => !existing.has(u));
  const dup = links.length - fresh.length;
  if (!fresh.length) { toast("そのリンクはすでに追加されています"); return; }
  // 何も入っていない行（リンク未入力）は取り除いてから追加
  visitRows = visitRows.filter((v, i) => i !== replaceIdx && (v[mapsField.id] || "").trim());
  const start = visitRows.length;
  fresh.forEach((u) => visitRows.push({ [mapsField.id]: u }));
  renderVisitRows();
  const cards = [...document.querySelectorAll("#visitRows .row-card")].slice(start);
  toast(`${fresh.length}件を追加しました${dup ? `（同じリンク${dup}件は省きました）` : ""}。店舗情報を読み取ります`);
  for (const c of cards) await lookupRow(c);
  toast("読み取りが終わりました。内容を確認して保存してください");
}
// 1つの欄に複数のリンクを貼ったときも、1リンク＝1件に分ける
$("#visitRows").addEventListener("paste", (e) => {
  const el = e.target.closest("[data-field-id]");
  if (!el || formats.visit.find((f) => f.id === el.dataset.fieldId)?.type !== "maps") return;
  const links = splitLinks(e.clipboardData?.getData("text") || "");
  if (links.length < 2) return;
  e.preventDefault();
  addLinksAsRows(links, el.closest(".row-card"));
});

$("#addVisitRow").addEventListener("click", () => {
  syncVisitRows();
  visitRows.push({});
  renderVisitRows();
  const cards = document.querySelectorAll("#visitRows .row-card");
  cards[cards.length - 1]?.scrollIntoView({ behavior: "smooth", block: "center" });
});

$("#visitRows").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-remove-row]");
  if (!btn) return;
  syncVisitRows();
  visitRows.splice(Number(btn.dataset.removeRow), 1);
  renderVisitRows();
});

function resetVisitForm() {
  editingVisitId = null;
  visitRows = [];
  $("#visitFormTitle").textContent = "訪問リストを入力";
  $("#saveVisits").textContent = "まとめて保存";
  $("#cancelVisitEdit").classList.add("hidden");
  clearError($("#visitError"));
  $("#visitDate").value = tomorrow();
  renderVisitRows();
}

$("#cancelVisitEdit").addEventListener("click", resetVisitForm);

/* ---------- Googleマップのリンクから店舗情報を読み取る ---------- */
const lookupCache = new Map();
async function mapsLookup(url) {
  if (lookupCache.has(url)) return lookupCache.get(url);
  // 通信の一時的な失敗（圏外・混雑）は1回だけ自動でやり直す
  const call = () => fetch(`/api/maps-info?url=${encodeURIComponent(url)}`);
  let r;
  try { r = await call(); } catch { await new Promise((res) => setTimeout(res, 800)); r = await call(); }
  if (r.status >= 500) { await new Promise((res) => setTimeout(res, 800)); r = await call(); }
  if (!r.ok && r.status !== 400) throw Object.assign(new Error(`読み取りサービスに接続できません（${r.status}）`), { code: r.status === 404 ? "lookup-missing" : "unavailable" });
  const j = await r.json();
  if (j.ok) lookupCache.set(url, j);
  return j;
}
// 読み取った値を、その行の「空欄」にだけ入れる（入力済みは上書きしない）
const LOOKUP_MAP = { shopName: "name", prefecture: "prefecture", city: "city", ward: "ward", area: "area", address: "address", category: "category", phone: "phone", hours: "hours", rating: "rating", website: "website" };
function applyLookup(row, info, overwrite = false) {
  let n = 0;
  row.querySelectorAll("[data-field-id]").forEach((el) => {
    const id = el.dataset.fieldId;
    const label = formats.visit.find((f) => f.id === id)?.label || "";
    // 管理者が追加した項目でも、名前で判断して入れる
    const key = LOOKUP_MAP[id] || autoKeyByLabel(label, el.type);
    if (key && info[key] && (overwrite || !el.value)) { el.value = info[key]; n++; }
  });
  updateRowSummary(row);
  return n;
}

/* 行の上に「読み取った内容」の要約を出す（修正は「確認・修正」を開いて行う） */
function updateRowSummary(row) {
  const box = row.querySelector(".row-summary");
  if (!box) return;
  const val = (id) => row.querySelector(`[data-field-id="${CSS.escape(id)}"]`)?.value.trim() || "";
  const name = val("shopName");
  const hours = val("hours").split("\n")[0];
  const parts = [["都道府県", val("prefecture")], ["市", val("city")], ["区", val("ward")], ["業種", val("category")]].filter(([, x]) => x);
  const place = parts.length || val("area");
  box.innerHTML = name || place ? `
    <div class="sum-name">${esc(name || "（店舗名なし）")}</div>
    <div class="tags">${parts.map(([k, x]) => `<span class="tag" title="${k}">${esc(x)}</span>`).join("") || (val("area") ? `<span class="tag">${esc(val("area"))}</span>` : "")}</div>
    ${hours ? `<div class="sum-sub">🕒 営業時間：${esc(hours)}${val("hours").includes("\n") ? " ほか" : ""}</div>` : ""}` : "";
}
function setRowStatus(row, text, cls = "") {
  let s = row.querySelector(".lookup-status");
  if (!s) {
    s = document.createElement("span");
    s.className = "lookup-status";
    const mapsInput = [...row.querySelectorAll("[data-field-id]")].find((el) => formats.visit.find((f) => f.id === el.dataset.fieldId)?.type === "maps");
    (mapsInput?.closest("label") || row).appendChild(s);
  }
  s.textContent = text;
  s.className = `lookup-status ${cls}`;
}
async function lookupRow(row, overwrite = false) {
  const mapsInput = [...row.querySelectorAll("[data-field-id]")].find((el) => formats.visit.find((f) => f.id === el.dataset.fieldId)?.type === "maps");
  const url = mapsInput?.value.trim();
  if (!url || !MAPS_REGEX.test(url)) return null;
  setRowStatus(row, "マップから店舗情報を読み取り中…");
  try {
    if (overwrite) lookupCache.delete(url);
    const info = await mapsLookup(url);
    if (!info.ok) { setRowStatus(row, `読み取れませんでした：${info.error || "不明な理由"}（手入力してください）`, "ng"); return info; }
    const n = applyLookup(row, info, overwrite);
    const what = [info.name, info.area, info.category && `業種：${info.category}${info.categorySource ? `（${info.categorySource}）` : ""}`].filter(Boolean).join("・");
    const note = (info.notes || []).join(" / ");
    const dup = duplicateNote(row, info);
    setRowStatus(row, `✓ ${what || "読み取りました"}${n ? `（${n}項目を入力）` : "（空欄はありませんでした）"}${note ? `　※${note}` : ""}${dup ? `\n${dup}` : ""}`, dup ? "ok dup" : "ok");
    return info;
  } catch (err) {
    const why = err.code === "lookup-missing" ? "読み取り機能がまだサーバーに入っていません（管理者に連絡してください）" : explainError(err).cause;
    setRowStatus(row, `読み取れませんでした：${why}（手入力で保存できます）`, "ng");
    return null;
  }
}
$("#visitRows").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-relookup]");
  if (!b) return;
  const row = b.closest(".row-card");
  b.disabled = true;
  const info = await lookupRow(row, true);
  b.disabled = false;
  if (info?.ok) { const more = row.querySelector(".row-more"); if (more) more.open = true; }
  else if (!info) toast("先にGoogleマップのリンクを入れてください");
});
// マップのURLを貼ったら自動で読み取る
$("#visitRows").addEventListener("change", (e) => {
  const el = e.target.closest("[data-field-id]");
  if (el && formats.visit.find((f) => f.id === el.dataset.fieldId)?.type === "maps") lookupRow(el.closest(".row-card"));
});

/* リンクをまとめて貼り付け → 1リンク1行で作って読み取る */
async function runBulkAdd() {
  const links = splitLinks($("#bulkLinks").value);
  if (!links.length) { toast("Googleマップのリンクが見つかりませんでした"); return; }
  $("#bulkLinks").value = "";
  await addLinksAsRows(links);
}
// 「貼り付け」ボタン：コピーしてあるリンクをそのまま取り込んで読み取る
$("#bulkPaste").addEventListener("click", async () => {
  const box = $("#bulkLinks");
  if (!navigator.clipboard?.readText) {
    box.focus();
    toast("このブラウザではボタンで貼り付けできません。入力欄を長押し（またはCtrl+V）して貼り付けてください");
    return;
  }
  let text = "";
  try {
    text = (await navigator.clipboard.readText()) || "";
  } catch {
    box.focus();
    toast("貼り付けが許可されませんでした。入力欄を長押し（またはCtrl+V）して貼り付けてください");
    return;
  }
  if (!text.trim()) { toast("コピーされたものがありません。先にGoogleマップのリンクをコピーしてください"); return; }
  if (!splitLinks(text).length) { toast("コピーした内容にGoogleマップのリンクが見つかりませんでした"); return; }
  box.value = box.value.trim() ? `${box.value.trim()}\n${text}` : text;
  await runBulkAdd();
});
// 貼り付けた瞬間に自動で読み取る（ボタンを押さなくてもOK）
$("#bulkLinks").addEventListener("paste", () => setTimeout(() => {
  if (splitLinks($("#bulkLinks").value).length) runBulkAdd();
}, 0));

$("#visitForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = $("#visitError");
  clearError(errEl);
  const visitDate = $("#visitDate").value;
  if (!visitDate) { errEl.textContent = "訪問日を入力してください。"; return; }

  // まだ読み取っていないマップURLがあれば、保存前に読み取って空欄を埋める
  const rowEls = [...document.querySelectorAll("#visitRows .row-card")];
  const pending = rowEls.filter((row) => {
    const st = row.querySelector(".lookup-status");
    return !st && [...row.querySelectorAll("[data-field-id]")].some((el) => formats.visit.find((f) => f.id === el.dataset.fieldId)?.type === "maps" && MAPS_REGEX.test(el.value.trim()));
  });
  if (pending.length) {
    $("#saveVisits").disabled = true;
    $("#saveVisits").textContent = "マップから読み取り中…";
    for (const row of pending) await lookupRow(row);
    $("#saveVisits").disabled = false;
    $("#saveVisits").textContent = editingVisitId ? "更新する" : "まとめて保存";
  }

  const rows = rowEls.map((row) => collectItems(row, formats.visit));
  const filled = rows.map((items, idx) => ({ items, idx })).filter((r) => r.items.some((i) => i.value));
  if (!filled.length) { errEl.textContent = "1件以上入力してください。"; return; }
  for (const r of filled) {
    const err = validateItems(formats.visit, r.items, editingVisitId ? "" : `${r.idx + 1}件目の`);
    if (err) {
      errEl.textContent = err + "（カードの「読み取った内容を確認・修正」を開いて入力してください）";
      const more = rowEls[r.idx]?.querySelector(".row-more");
      if (more) { more.open = true; more.scrollIntoView({ behavior: "smooth", block: "center" }); }
      return;
    }
  }

  $("#saveVisits").disabled = true;
  try {
    if (editingVisitId) {
      const prevV = visits.find((x) => x.id === editingVisitId);
      await updateDoc(doc(db, "visits", editingVisitId), {
        visitDate, items: filled[0].items,
        updatedAt: serverTimestamp(), updatedBy: currentUser.email
      });
      if (prevV) historyUpdate("visits", prevV, ["visitDate", "items"], { visitDate, items: filled[0].items }, "訪問先の編集");
      toast("更新しました");
      if (prevV?.caseNo && itemVal(prevV.items, "mapsUrl") !== itemVal(filled[0].items, "mapsUrl")) queueDemos([{ caseNo: prevV.caseNo, visitDate, items: filled[0].items }]);
    } else {
      // 案件番号は共通カウンターから連番で取る（同時に保存しても番号が被らない）
      const counterRef = doc(db, "counters", "caseNo");
      const nos = await runTransaction(db, async (tx) => {
        const snap = await tx.get(counterRef);
        const last = snap.exists() ? (snap.data().last || 0) : 0;
        const next = last + filled.length;
        tx.set(counterRef, { last: next, updatedAt: serverTimestamp() });
        return filled.map((r, n) => {
          const caseNo = fmtCaseNo(last + n + 1);
          tx.set(doc(collection(db, "visits")), {
            caseNo, visitDate, items: r.items, order: n,
            authorUid: currentUser.uid,
            authorEmail: currentUser.email,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
          return caseNo;
        });
      });
      toast(`${filled.length}件保存しました（${nos[0]}${nos.length > 1 ? `〜${nos[nos.length - 1]}` : ""}）`);
      queueDemos(filled.map((r, n) => ({ caseNo: nos[n], visitDate, items: r.items })));
      store.del("visits");
    }
    $("#visitFilterDate").value = visitDate;
    resetVisitForm();
    renderVisitList();
  } catch (err) {
    showError(errEl, err, editingVisitId ? "訪問先の更新" : "訪問リストの保存");
  } finally {
    $("#saveVisits").disabled = false;
  }
});

/* ---------- 翌日訪問リスト：一覧 ---------- */
$("#visitFilterDate").addEventListener("change", renderVisitList);
$("#visitShowTomorrow").addEventListener("click", () => { $("#visitFilterDate").value = tomorrow(); renderVisitList(); });
$("#visitShowAll").addEventListener("click", () => { $("#visitFilterDate").value = ""; renderVisitList(); });

$("#visitSort").addEventListener("change", renderVisitList);

const caseNum = (v) => caseSeq(v.caseNo);
const timeOf = (v) => (v.items || []).find((i) => i.type === "time")?.value || "99:99";
const textOf = (v, id) => (v.items || []).find((i) => i.id === id)?.value || "";
/* 住所の文字から 都道府県／市／区 を分ける（項目が空のときの予備） */
function splitPlace(text) {
  const t = String(text || "").replace(/^日本[、,]?\s*/, "").replace(/〒?\s*\d{3}-?\d{4}\s*/, "").trim();
  const m = t.match(/^(北海道|東京都|京都府|大阪府|.{2,3}?県)\s*(.*)$/);
  if (!m) return {};
  const pref = m[1], rest = m[2];
  let city = "", ward = "";
  if (pref === "東京都") {
    const w = rest.match(/^([^市区]+区)/);
    if (w) ward = w[1]; else { const c = rest.match(/^(.+?市)/); if (c) city = c[1]; }
  } else {
    const c = rest.match(/^(.+?市|.+?郡[^市区町村]+[町村]|[^市区]+?[町村])/);
    if (c) city = c[1];
    const w = rest.slice(city.length).match(/^([^市区]+区)/);
    if (w) ward = w[1];
  }
  return { prefecture: pref, city, ward };
}
/* 店舗名に住所などが続いていたら、店舗名の部分だけにする */
function cleanName(name) {
  let n = String(name || "").split(/\r?\n/)[0].trim();
  const i = n.search(/〒|\d{3}-\d{4}|(北海道|東京都|京都府|大阪府|[^\s、,]{2,3}県)[^\s]*?[市区町村郡]/);
  if (i > 0) n = n.slice(0, i);
  return n.replace(/[\s　、,・｜|]+$/, "").trim();
}
/* 県・市・区を別々に返す（保存されていなければ、地域や住所の文字から分ける） */
function placeParts(v) {
  let prefecture = textOf(v, "prefecture"), city = textOf(v, "city"), ward = textOf(v, "ward");
  if (!prefecture && !city && !ward) {
    const sp = splitPlace(textOf(v, "area") || textOf(v, "address"));
    prefecture = sp.prefecture || ""; city = sp.city || ""; ward = sp.ward || "";
  }
  return { prefecture, city, ward };
}
/* 業種：項目の名前が違っていても「業種・ジャンル・カテゴリ」の項目から取る */
const catOf = (v) => textOf(v, "category") || (v.items || []).find((i) => /業種|ジャンル|カテゴリ/.test(i.label || "") && i.value)?.value || "";
/* 住所：住所の項目がなければ 県・市・区 をつなげる */
/* 業種（飲食店・美容院・アパレル・整体・整骨院・不動産・建築・土木・その他）。以前の自由入力の値は選別し直して表示。未入力は "" */
const industryOf = (v) => { const c = catOf(v); return !c ? "" : INDUSTRIES.includes(c) ? c : (classifyIndustry(c, textOf(v, "shopName")) || "その他"); };
const addressOf = (v) => textOf(v, "address") || (v.items || []).find((i) => /住所|所在地/.test(i.label || "") && i.value)?.value || placeOf(v);
const shopOf = (v) => cleanName(textOf(v, "shopName")) || textOf(v, "shopName") || "";
const placeOf = (v) => { const p = placeParts(v); return [p.prefecture, p.city, p.ward].join("") || textOf(v, "area"); };
const created = (v) => (v.createdAt?.toMillis ? v.createdAt.toMillis() : Date.now() + 1e12);
const VISIT_SORTERS = {
  caseDesc: (a, b) => caseNum(b) - caseNum(a) || created(b) - created(a),
  caseAsc: (a, b) => (caseNum(a) || 1e9) - (caseNum(b) || 1e9) || created(a) - created(b),
  dateTime: (a, b) => (a.visitDate || "").localeCompare(b.visitDate || "") || timeOf(a).localeCompare(timeOf(b)) || caseNum(a) - caseNum(b),
  area: (a, b) => byEmptyLast(placeOf(a), placeOf(b), true) || caseNum(b) - caseNum(a),
  shop: (a, b) => byEmptyLast(shopOf(a), shopOf(b), true) || caseNum(b) - caseNum(a),
  manual: (a, b) => manualIdx(a) - manualIdx(b)
};
/* 手動の並び順：自分が並べた順。まだ並べていないものは案件番号の古い順で後ろに */
const manualIdx = (v) => { const i = myOrder.indexOf(v.id); return i >= 0 ? i : 1e6 + caseNum(v); };
async function moveVisit(id, dir) {
  const ids = filteredVisits().map((v) => v.id);
  const i = ids.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  myOrder = [...ids, ...myOrder.filter((x) => !ids.includes(x))].slice(0, 1500);
  renderVisitList();
  try { await setDoc(doc(db, "users", currentUser.uid), { visitOrder: myOrder }, { merge: true }); }
  catch (err) { showBanner(err, "並び順の保存"); }
}

/* ---- 担当者で絞り込み・キーワード検索・担当者別の件数 ---- */
const personOf = (v) => textOf(v, "personName") || (v.items || []).find((i) => /担当/.test(i.label || "") && i.value)?.value || "";
const NO_PERSON = "__none";
function isMine(v) {
  // 自分＝担当者名が固定した自分の名前の訪問（名前未設定なら、自分が登録した訪問）
  return myName ? personOf(v) === myName : v.authorUid === currentUser?.uid;
}
function refreshIndustryOptions() {
  const sel = $("#visitIndustry");
  const cur = sel.value;
  sel.innerHTML = `<option value="">すべての業種</option>` + INDUSTRIES.map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join("") + `<option value="${NO_PERSON}">業種 未入力</option>`;
  sel.value = [...sel.options].some((o) => o.value === cur) ? cur : "";
}
function refreshPersonOptions() {
  const sel = $("#visitPerson");
  const cur = sel.value ?? "__me"; // 「全員」（空文字）も、そのまま保つ
  const names = [...new Set(visits.map(personOf).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
  const hasNone = visits.some((v) => !personOf(v));
  sel.innerHTML = `<option value="__me">自分${myName ? `（${esc(myName)}）` : ""}</option><option value="">全員</option>` +
    names.filter((n) => n !== myName).map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join("") +
    (hasNone ? `<option value="${NO_PERSON}">担当者なし</option>` : "");
  sel.value = [...sel.options].some((o) => o.value === cur) ? cur : "__me";
}
function personMatch(v, p) {
  if (!p) return true;
  if (p === "__me") return isMine(v);
  if (p === NO_PERSON) return !personOf(v);
  return personOf(v) === p;
}
function keywordMatch(v, q) {
  if (!q) return true;
  const text = [v.caseNo, v.visitDate, v.authorEmail, ...(v.items || []).map((i) => i.value)].join(" ").toLowerCase();
  return q.split(/\s+/).every((w) => text.includes(w));
}
$("#visitPerson").addEventListener("change", renderVisitList);
$("#visitIndustry").addEventListener("change", renderVisitList);
$("#visitSearch").addEventListener("input", renderVisitList);

function filteredVisits() {
  const f = $("#visitFilterDate").value;
  const sort = $("#visitSort").value || "caseDesc";
  const p = $("#visitPerson").value;
  const q = $("#visitSearch").value.trim().toLowerCase();
  return visits
    .filter((v) => (!f || v.visitDate === f) && personMatch(v, p) && industryMatch(v, $("#visitIndustry").value) && keywordMatch(v, q))
    .sort(VISIT_SORTERS[sort] || VISIT_SORTERS.caseDesc);
}

/* 担当者ごとの件数（表示中の日付。全日付のときは日付ごと）。担当者の絞り込みに関係なく全員分を出す */
function renderPersonCounts() {
  const f = $("#visitFilterDate").value;
  const q = $("#visitSearch").value.trim().toLowerCase();
  const base = visits.filter((v) => (!f || v.visitDate === f) && keywordMatch(v, q));
  const box = $("#personCounts");
  if (!base.length) { box.innerHTML = ""; return; }
  const dates = f ? [f] : [...new Set(base.map((v) => v.visitDate || ""))].sort().slice(0, 7);
  const cur = $("#visitPerson").value;
  box.innerHTML = `<div class="pc-title">👥 担当者別の件数${f ? "" : "（日付ごと・直近7日分）"}</div>` + dates.map((d) => {
    const counts = {};
    base.filter((v) => (v.visitDate || "") === d).forEach((v) => { const n = personOf(v) || "担当者なし"; counts[n] = (counts[n] || 0) + 1; });
    const total0 = Object.values(counts).reduce((a, b) => a + b, 0);
    const allChip = `<button type="button" class="pc-chip${cur === "" ? " active" : ""}" data-person="">全員 <b>${total0}件</b></button>`;
    const chips = allChip + Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja")).map(([n, c]) => {
      const val = n === "担当者なし" ? NO_PERSON : (n === myName ? "__me" : n);
      return `<button type="button" class="pc-chip${cur === val ? " active" : ""}" data-person="${esc(val)}">${esc(n)}${n === myName ? "（自分）" : ""} <b>${c}件</b></button>`;
    }).join("");
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return `<div class="pc-row"><span class="pc-date">${esc(fmtDateJa(d))}</span>${chips}</div>`;
  }).join("");
}
$("#personCounts").addEventListener("click", (e) => {
  const chip = e.target.closest("[data-person]");
  if (!chip) return;
  const sel = $("#visitPerson");
  sel.value = sel.value === chip.dataset.person ? "" : chip.dataset.person; // もう一度押すと絞り込みが消えて全員に戻る
  renderVisitList();
});

function updateCaseNoList() {
  const dl = $("#caseNoList");
  if (!dl) return;
  dl.innerHTML = [...visits]
    .filter((v) => v.caseNo)
    .sort((a, b) => (b.caseNo || "").localeCompare(a.caseNo || ""))
    .map((v) => {
      const shop = textOf(v, "shopName") || (v.items || []).find((i) => i.type === "text" && i.value)?.value || "";
      return `<option value="${esc(v.caseNo)}">${esc(`${shop}（${v.visitDate || ""}）`)}</option>`;
    }).join("");
}

/* 訪問予定時刻：カードの上で「◯時」を選ぶだけ（自分が登録したもの／管理者のみ変更可） */
const TIME_HOURS = Array.from({ length: 18 }, (_, i) => i + 6); // 6時〜23時
function timeSelectHtml(v, time) {
  const h = /^\d{1,2}:/.test(time) ? parseInt(time, 10) : null;
  if (!canModify(v)) return h !== null ? `🕒 ${h}時` : "";
  return `<label class="vtime">🕒 <select data-vtime="${esc(v.id)}" aria-label="訪問予定時刻">
    <option value="">時間未定</option>${TIME_HOURS.map((x) => `<option value="${pad(x)}:00"${x === h ? " selected" : ""}>${x}時</option>`).join("")}
  </select></label>`;
}
$("#visitList").addEventListener("change", async (e) => {
  const sel = e.target.closest("select[data-vtime]");
  if (!sel) return;
  const v = visits.find((x) => x.id === sel.dataset.vtime);
  if (!v || !canModify(v)) return;
  const items = clone(v.items || []);
  const t = items.find((i) => i.type === "time");
  if (t) t.value = sel.value;
  else items.push({ id: "visitTime", label: "訪問予定時刻", type: "time", value: sel.value });
  try {
    await updateDoc(doc(db, "visits", v.id), { items, updatedAt: serverTimestamp(), updatedBy: currentUser.email });
    historyUpdate("visits", v, ["items"], { items }, "訪問時刻の変更");
    toast(sel.value ? `${parseInt(sel.value, 10)}時に変更しました` : "時間を未定にしました");
  } catch (err) { showBanner(err, "訪問予定時刻の変更"); renderVisitList(); }
});
/* 業種が空の訪問先を、Googleマップから読み取って自動入力（空の項目だけ埋める） */
$("#visitList").addEventListener("click", async (e) => {
  const fb = e.target.closest("button[data-fillcat]");
  if (!fb) return;
  const v = visits.find((x) => x.id === fb.dataset.fillcat);
  const url = (v?.items || []).find((i) => i.type === "maps" && i.value)?.value;
  if (!v || !canModify(v)) return;
  if (!url) { toast("この訪問先にはGoogleマップのリンクがないので、「編集」から業種を入力してください"); return; }
  const label = fb.textContent;
  fb.disabled = true; fb.textContent = "読み取り中…";
  try {
    lookupCache.delete(url);
    const info = await mapsLookup(url);
    if (!info.ok || !info.category) { toast(info.ok ? "Googleマップに業種の情報がありませんでした。「編集」から入力してください" : (info.error || "読み取れませんでした")); fb.disabled = false; fb.textContent = label; return; }
    const items = clone(v.items || []);
    formats.visit.filter((f) => f.type !== "maps").forEach((f) => {
      const key = LOOKUP_MAP[f.id] || autoKeyByLabel(f.label, f.type);
      if (!key || !info[key]) return;
      let it = items.find((i) => i.id === f.id);
      if (!it) { it = { id: f.id, label: f.label, type: f.type, value: "" }; items.push(it); }
      if (!it.value) it.value = info[key];
    });
    if (!catOf({ items })) items.push({ id: "category", label: "業種", type: "select", value: info.category });
    await updateDoc(doc(db, "visits", v.id), { items, updatedAt: serverTimestamp(), updatedBy: currentUser.email });
    historyUpdate("visits", v, ["items"], { items }, "業種の自動入力");
    toast(`業種を「${info.category}」に入れました`);
  } catch (err) { showBanner(err, "業種の自動入力"); fb.disabled = false; fb.textContent = label; }
});
$("#visitList").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-vmove]");
  if (b) moveVisit(b.dataset.id, Number(b.dataset.vmove));
});

function renderVisitList() {
  if (!currentUser) return;
  updateCaseNoList();
  refreshPersonOptions();
  refreshIndustryOptions();
  renderPersonCounts();
  const list = filteredVisits();
  const f = $("#visitFilterDate").value;
  if (!list.length) {
    const p = $("#visitPerson").value;
    const who = p === "__me" ? "自分の" : p && p !== NO_PERSON ? `${p}さんの` : "";
    const q = $("#visitSearch").value.trim();
    $("#visitList").innerHTML = `<p class="empty">${q ? `「${esc(q)}」に合う` : ""}${f ? `${fmtDateJa(f)}の` : ""}${esc(who)}訪問予定はありません${p ? "<br><small>担当者を「全員」にすると、ほかの人の予定も見られます</small>" : ""}</p>`;
    return;
  }
  const sort = $("#visitSort").value || "caseDesc";
  const grouped = sort === "dateTime"; // 日付順のときだけ日付ごとに見出しを付ける
  let html = grouped ? "" : `<p class="hint">${list.length}件</p>`;
  let lastDate = null;
  list.forEach((v) => {
    if (grouped && v.visitDate !== lastDate) {
      const count = list.filter((x) => x.visitDate === v.visitDate).length;
      html += `<div class="group-title">${fmtDateJa(v.visitDate)}　${count}件</div>`;
      lastDate = v.visitDate;
    }
    const items = v.items || [];
    let titleIdx = items.findIndex((i) => i.id === "shopName" && i.value);
    if (titleIdx < 0) titleIdx = items.findIndex((i) => i.value && i.type === "text");
    const title = titleIdx >= 0 ? items[titleIdx].value : "（店舗名なし）";
    const subIds = ["area", "prefecture", "city", "ward", "category", "hours"];
    const time = items.find((i) => i.type === "time" && i.value)?.value || "";
    const pp = placeParts(v);
    const cat = industryOf(v);
    const hoursTxt = textOf(v, "hours");
    const when = [
      !grouped && v.visitDate ? `📅 ${esc(fmtDateJa(v.visitDate))}` : "",
      timeSelectHtml(v, time)
    ].filter(Boolean).join(" ");
    const tags = [["都道府県", pp.prefecture], ["市", pp.city], ["区", pp.ward]]
      .filter(([, val]) => val)
      .map(([k, val]) => `<span class="tag" title="${k}">${esc(val)}</span>`).join("") +
      (cat ? `<span class="tag cat" title="業種">🏷 ${esc(cat)}</span>` : `<span class="tag none" title="業種">🏷 業種：未取得</span>${canModify(v) ? `<button class="btn small" type="button" data-fillcat="${esc(v.id)}">業種を自動入力</button>` : ""}`);
    const hoursHtml = hoursTxt ? `<p class="visit-hours">🕒 営業時間：${esc(hoursTxt.split("\n")[0])}${hoursTxt.includes("\n") ? ` <small>ほか（下の「店舗の詳細」に全部あります）</small>` : ""}</p>` : "";
    const moveBtns = sort === "manual" ? `<span class="move-btns"><button class="btn small" type="button" data-vmove="-1" data-id="${esc(v.id)}" title="上へ">↑</button><button class="btn small" type="button" data-vmove="1" data-id="${esc(v.id)}" title="下へ">↓</button></span>` : "";
    const rest = items.filter((i, k) => k !== titleIdx && !subIds.includes(i.id) && i.type !== "time");
    const main = rest.filter((i) => ["personName", "phone", "maps", "memo"].includes(i.id) || i.type === "maps");
    const more = [...items.filter((i) => i.id === "hours" && i.value), ...rest.filter((i) => !main.includes(i))];
    const actions = canModify(v) ? `
      <span class="btn-row" style="margin:0">
        <button class="btn small" type="button" data-vedit="${esc(v.id)}">編集</button>
        <button class="btn small danger" type="button" data-vdel="${esc(v.id)}">削除</button>
      </span>` : "";
    const caseTag = v.caseNo ? `<span class="case-no">${esc(v.caseNo)}</span>
        <button class="btn small" type="button" data-copy="${esc(v.caseNo)}">番号をコピー</button>` : "";
    const st = visitStatus(v);
    html += `<div class="visit-item${st.done ? " is-done" : ""}">
      <div class="report-head"><p class="report-title">${esc(cleanName(title) || title)}</p><span class="btn-row" style="margin:0;align-items:center">${caseTag}</span></div>
      <p class="visit-sub">${when}${moveBtns}</p>
      <div class="tags">${tags}</div>
      ${hoursHtml}
      <div class="btn-row visit-status">${st.html}
        ${st.done ? "" : `<button class="btn small primary" type="button" data-report-visit="${esc(v.id)}">この訪問を報告する</button>`}
        ${v.demoUrl ? `<a class="btn small" href="${esc(v.demoUrl)}" target="_blank" rel="noopener">デモサイトを開く</a><button class="btn small" type="button" data-copy="${esc(v.demoUrl)}">デモURLをコピー</button>` : ""}
      </div>
      ${itemsDl(main)}
      ${more.some((i) => i.value) ? `<details class="report-details"><summary>店舗の詳細（住所・営業時間など）</summary>${itemsDl(more)}</details>` : ""}
      <div class="report-foot"><span>${esc(v.authorEmail)}・${fmtTs(v.createdAt)}</span>${actions}</div>
    </div>`;
  });
  $("#visitList").innerHTML = html;
}

$("#copyAllClaude").addEventListener("click", () => {
  const urls = filteredVisits().flatMap((v) => (v.items || []).filter((i) => i.type === "maps" && i.value).map((i) => i.value));
  if (!urls.length) { toast("GoogleマップのURLがありません"); return; }
  copyText(urls.map(CLAUDE_TEMPLATE).join("\n"));
});

$("#visitList").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-vedit], button[data-vdel]");
  if (!btn) return;
  const v = visits.find((x) => x.id === (btn.dataset.vedit || btn.dataset.vdel));
  if (!v || !canModify(v)) return;
  if (btn.dataset.vedit) {
    editingVisitId = v.id;
    visitRows = [toValues(v.items)];
    $("#visitDate").value = v.visitDate || tomorrow();
    $("#visitFormTitle").textContent = "訪問先を編集";
    $("#saveVisits").textContent = "更新する";
    $("#cancelVisitEdit").classList.remove("hidden");
    clearError($("#visitError"));
    renderVisitRows();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  if (btn.dataset.vdel) {
    if (!confirm("この訪問先を削除しますか？（上の「戻る」で元に戻せます）")) return;
    try { await deleteDoc(doc(db, "visits", v.id)); historyDelete("visits", v, "訪問先の削除"); toast("削除しました（「戻る」で復元できます）"); }
    catch (err) { showBanner(err, "削除"); }
  }
});

/* ---------- フォーマット編集（管理者のみ） ---------- */
document.querySelectorAll(".sub-tab").forEach((b) => b.addEventListener("click", () => {
  adminSection = b.dataset.fmt;
  document.querySelectorAll(".sub-tab").forEach((x) => x.classList.toggle("active", x === b));
  renderFieldEditor();
}));

function renderFieldEditor() {
  if (!isAdmin()) return;
  if (!drafts[adminSection]) drafts[adminSection] = clone(formats[adminSection]);
  const fields = drafts[adminSection];
  $("#fmtHint").textContent = FORMATS[adminSection].hint;
  $("#fmtSection").innerHTML = adminSection === "nextAction" ? `
    <label class="check section-toggle">
      <input type="checkbox" id="naRequiredToggle"${draftNaRequired ? " checked" : ""}>
      完了報告で「次回アクション」の入力を必須にする
    </label>
    <p class="hint">オフにすると、次回アクションを空欄のまま完了報告を保存できます（入力した場合は、下の各項目の「必須」がチェックされます）。</p>` : "";

  const typeOpts = (cur) => Object.entries(TYPE_LABELS)
    .map(([v, l]) => `<option value="${v}"${v === cur ? " selected" : ""}>${l}</option>`).join("");

  $("#fieldEditor").innerHTML = fields.map((f, i) => `
    <div class="field-row" data-index="${i}">
      <div class="field-row-grid">
        <label>項目名<input type="text" data-prop="label" value="${esc(f.label)}"></label>
        <label>種類<select data-prop="type"${f.locked ? " disabled" : ""}>${typeOpts(f.type)}</select></label>
      </div>
      ${f.type === "select" ? `<label>選択肢（1行に1つ）<textarea data-prop="options" rows="4">${esc((f.options || []).join("\n"))}</textarea></label>` : ""}
      <label class="check"><input type="checkbox" data-prop="required"${f.required ? " checked" : ""}> 必須にする</label>
      ${f.locked ? `<p class="locked">固定項目（削除・種類の変更はできません。名前・必須・並び順は変更できます）</p>` : ""}
      <div class="btn-row">
        <button class="btn small" type="button" data-move="-1"${i === 0 ? " disabled" : ""}>↑ 上へ</button>
        <button class="btn small" type="button" data-move="1"${i === fields.length - 1 ? " disabled" : ""}>↓ 下へ</button>
        ${f.locked ? "" : `<button class="btn small danger" type="button" data-remove>削除</button>`}
      </div>
    </div>`).join("");
}

$("#fieldEditor").addEventListener("input", (e) => {
  const row = e.target.closest(".field-row");
  if (!row) return;
  const f = drafts[adminSection][+row.dataset.index];
  const prop = e.target.dataset.prop;
  if (prop === "label") f.label = e.target.value;
  if (prop === "options") f.options = e.target.value.split("\n").map((s) => s.trim()).filter(Boolean);
  if (prop === "required") f.required = e.target.checked;
});

$("#fieldEditor").addEventListener("change", (e) => {
  if (e.target.dataset.prop !== "type") return;
  const f = drafts[adminSection][+e.target.closest(".field-row").dataset.index];
  f.type = e.target.value;
  if (f.type === "select" && !f.options) f.options = [];
  renderFieldEditor();
});

$("#fieldEditor").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const i = +btn.closest(".field-row").dataset.index;
  const fields = drafts[adminSection];
  if (btn.dataset.move) {
    const j = i + Number(btn.dataset.move);
    [fields[i], fields[j]] = [fields[j], fields[i]];
  }
  if (btn.dataset.remove !== undefined) {
    if (fields[i].locked) return;
    if (!confirm(`項目「${fields[i].label}」を削除しますか？（過去に入力済みの内容は残ります）`)) return;
    fields.splice(i, 1);
  }
  renderFieldEditor();
});

$("#fmtSection").addEventListener("change", (e) => {
  if (e.target.id === "naRequiredToggle") draftNaRequired = e.target.checked;
});

$("#addField").addEventListener("click", () => {
  drafts[adminSection].push({ id: "f_" + Date.now().toString(36), label: "新しい項目", type: "text", required: false });
  renderFieldEditor();
});

$("#saveFormat").addEventListener("click", async () => {
  if (!isAdmin()) return;
  const fields = drafts[adminSection];
  if (!fields.length) { toast("項目を1つ以上残してください"); return; }
  if (fields.some((f) => !f.label.trim())) { toast("項目名が空の項目があります"); return; }
  if (fields.some((f) => f.type === "select" && !(f.options || []).length)) { toast("選択式の項目に選択肢を入れてください"); return; }
  try {
    const data = {
      fields: fields.map((f) => ({ ...f, label: f.label.trim() })),
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.email
    };
    if (adminSection === "nextAction") data.sectionRequired = draftNaRequired;
    if (adminSection === "visit") data.autoFieldsAdded = true;
    if (adminSection === "report") { data.photoFieldAdded = true; data.wealthFieldAdded = true; data.explainTimeFieldAdded = true; }
    await setDoc(doc(db, "settings", FORMATS[adminSection].doc), data);
    toast(`「${FORMATS[adminSection].title}」のフォーマットを保存しました`);
  } catch (err) {
    showBanner(err, "フォーマットの保存");
  }
});

renderVisitRows();

/* =====================================================================
   追加機能：許可制・今日・報告連携・重複チェック・写真・下書き・CSV・集計・Claude連携
   ===================================================================== */

/* ---------- 承認待ち（申請） ---------- */
let accessRequests = [];
function renderPending() {
  $("#pendingEmail").textContent = currentUser?.email || "";
  $("#pendingVerify").classList.toggle("hidden", !!currentUser?.emailVerified);
  getDoc(doc(db, "accessRequests", currentUser.uid)).then((s) => {
    if (s.exists()) {
      $("#pendingStatus").textContent = "✓ 申請済みです。管理者が許可すると、この画面が自動で切り替わります。";
      if (!$("#reqName").value) $("#reqName").value = s.data().name || "";
    } else {
      $("#pendingStatus").textContent = !membersLoaded ? "" : "まだ申請していません。お名前を入れて「利用を申請する」を押してください。";
    }
  }).catch(() => {});
}
$("#sendRequest").addEventListener("click", async () => {
  const name = $("#reqName").value.trim();
  if (!name) { toast("お名前を入力してください"); return; }
  try {
    await setDoc(doc(db, "accessRequests", currentUser.uid), {
      email: myEmail(), name, verified: !!currentUser.emailVerified, createdAt: serverTimestamp()
    });
    $("#pendingStatus").textContent = "✓ 申請しました。管理者が許可すると、この画面が自動で切り替わります。";
    toast("利用を申請しました");
  } catch (err) { showError($("#pendingStatus"), err, "利用の申請"); }
});
$("#copyMyEmail").addEventListener("click", () => copyText(currentUser?.email || ""));

/* ---------- メンバー管理（管理者） ---------- */
async function updateMembers(fn) {
  const ref = doc(db, "settings", "members");
  await runTransaction(db, async (tx) => {
    const s = await tx.get(ref);
    const d = s.exists() ? s.data() : {};
    const next = { emails: [...(d.emails || [])], admins: [...(d.admins || [])], names: { ...(d.names || {}) } };
    fn(next);
    next.emails = [...new Set(next.emails.map((e) => e.toLowerCase()))].sort();
    next.admins = [...new Set(next.admins.map((e) => e.toLowerCase()))].sort();
    tx.set(ref, { ...next, updatedAt: serverTimestamp(), updatedBy: myEmail() });
  });
}
function renderMembers() {
  if (!isAdmin() || !$("#memberList")) return;
  const all = [...new Set([ADMIN_EMAIL, ...(members.admins || []), ...(members.emails || [])])];
  $("#memberList").innerHTML = `<p class="hint">メンバー ${all.length}人</p>` + all.map((e) => {
    const owner = e === ADMIN_EMAIL;
    const admin = owner || (members.admins || []).includes(e);
    const name = members.names?.[e] || "";
    return `<div class="member-row">
      <span class="m-email">${esc(e)}${name ? `<small>（${esc(name)}）</small>` : ""}</span>
      <span class="badge ${admin ? "ok" : ""}">${owner ? "オーナー" : admin ? "管理者" : "メンバー"}</span>
      ${owner ? "" : `<span class="btn-row" style="margin:0">
        <button class="btn small" type="button" data-role="${esc(e)}">${admin ? "メンバーにする" : "管理者にする"}</button>
        <button class="btn small danger" type="button" data-unmember="${esc(e)}">利用を止める</button></span>`}
    </div>`;
  }).join("");
  const pend = accessRequests.filter((r) => !all.includes((r.email || "").toLowerCase()));
  $("#requestList").innerHTML = pend.length ? `<div class="req-box"><b>🔔 利用申請 ${pend.length}件</b>` + pend.map((r) => `
    <div class="member-row">
      <span class="m-email">${esc(r.email)}<small>（${esc(r.name || "")}）</small>${r.verified ? "" : '<small class="warn-text">※メール未確認</small>'}</span>
      <span class="btn-row" style="margin:0">
        <button class="btn small primary" type="button" data-approve="${esc(r.id)}">許可する</button>
        <button class="btn small" type="button" data-deny="${esc(r.id)}">却下</button>
      </span>
    </div>`).join("") + "</div>" : "";
}
$("#addMember").addEventListener("click", async () => {
  const email = $("#newMemberEmail").value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast("メールアドレスの形式が正しくありません"); return; }
  const role = $("#newMemberRole").value;
  try {
    await updateMembers((m) => { m.emails.push(email); if (role === "admin") m.admins.push(email); });
    $("#newMemberEmail").value = "";
    toast(`${email} を追加しました`);
  } catch (err) { showBanner(err, "メンバーの追加"); }
});
$("#tab-admin").addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  try {
    if (b.dataset.role) {
      const em = b.dataset.role;
      const toAdmin = !(members.admins || []).includes(em);
      await updateMembers((m) => { m.emails.push(em); m.admins = toAdmin ? [...m.admins, em] : m.admins.filter((x) => x !== em); });
      toast(toAdmin ? `${em} を管理者にしました` : `${em} をメンバーにしました`);
    }
    if (b.dataset.unmember) {
      const em = b.dataset.unmember;
      if (!confirm(`${em} の利用を止めますか？（これまでの報告は残ります）`)) return;
      await updateMembers((m) => { m.emails = m.emails.filter((x) => x !== em); m.admins = m.admins.filter((x) => x !== em); });
      toast(`${em} の利用を止めました`);
    }
    if (b.dataset.approve) {
      const r = accessRequests.find((x) => x.id === b.dataset.approve);
      if (!r) return;
      await updateMembers((m) => { m.emails.push(r.email); if (r.name) m.names[r.email.toLowerCase()] = r.name; });
      await deleteDoc(doc(db, "accessRequests", r.id));
      toast(`${r.name || r.email} さんを許可しました`);
    }
    if (b.dataset.deny) {
      await deleteDoc(doc(db, "accessRequests", b.dataset.deny));
      toast("申請を却下しました");
    }
  } catch (err) { showBanner(err, "メンバーの変更"); }
});

/* ---------- 訪問と報告をつなげる ---------- */
const visitOfReport = (r) => { const k = norm(caseNoOfReport(r)); return k ? visits.find((x) => norm(x.caseNo) === k) : null; };
/* 報告一覧の「案件名」は店舗名 */
const reportTitle = (r) => { const v = visitOfReport(r); return (v && shopOf(v)) || itemVal(r.items, "caseName") || itemVal(r.items, "visitTo") || "（店舗名なし）"; };
const caseNoOfReport = (r) => (r.items || []).find((i) => i.type === "caseNo" && i.value)?.value || "";
function reportsOfCase(no) {
  const k = norm(no);
  return k ? reports.filter((r) => norm(caseNoOfReport(r)) === k) : [];
}
function visitStatus(v) {
  const rs = reportsOfCase(v.caseNo);
  if (!rs.length) return { done: false, html: `<span class="badge st-todo">未報告</span>` };
  const latest = [...rs].sort((a, b) => tsNum(b.createdAt) - tsNum(a.createdAt))[0];
  const res = itemVal(latest.items, "result");
  return { done: true, result: res, html: `<span class="badge st-done ${RESULT_CLASS[res] || ""}">報告済み${res ? `・${esc(res)}` : ""}</span>` };
}
/* 訪問から「報告する」→ 完了報告に案件番号を入れて自動入力 */
function reportFromVisit(v) {
  resetForm();
  showTab("form");
  const el = [...document.querySelectorAll("#reportCases [data-field-id]")].find((x) => formats.report.find((f) => f.id === x.dataset.fieldId)?.type === "caseNo");
  if (el && v.caseNo) { el.value = v.caseNo; fillFromCaseNo(el); }
  // デモサイトURLが自動登録されていれば入れる
  if (v.demoUrl) {
    const d = document.querySelector('#reportCases [data-field-id="demoUrl"]');
    if (d && !d.value) d.value = v.demoUrl;
  }
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-report-visit]");
  if (!b) return;
  const v = visits.find((x) => x.id === b.dataset.reportVisit);
  if (v) reportFromVisit(v);
});

/* ---------- 今日 ---------- */
function mapsDirUrl(list) {
  const dest = (v) => textOf(v, "address") || [shopOf(v), placeOf(v)].filter(Boolean).join(" ");
  const stops = list.map(dest).filter(Boolean);
  if (!stops.length) return "";
  const u = new URL("https://www.google.com/maps/dir/");
  u.searchParams.set("api", "1");
  u.searchParams.set("destination", stops[stops.length - 1]);
  if (stops.length > 1) u.searchParams.set("waypoints", stops.slice(0, -1).slice(0, 9).join("|"));
  return u.toString();
}
const demoLinksHtml = (url) => url ? `<a class="btn small" href="${esc(url)}" target="_blank" rel="noopener">🌐 デモサイト</a><button class="btn small" type="button" data-copy="${esc(url)}">デモURLをコピー</button>` : "";
function visitMiniHtml(v, opts = {}) {
  const st = visitStatus(v);
  const maps = (v.items || []).find((i) => i.type === "maps" && i.value)?.value;
  const time = (v.items || []).find((i) => i.type === "time" && i.value)?.value;
  return `<div class="mini-row">
    <div class="mini-main">
      <div class="mini-title">${time ? `<b>${esc(fmtHour(time))}</b> ` : ""}${v.caseNo ? `<span class="case-no">${esc(v.caseNo)}</span> ` : ""}${esc(shopOf(v) || "（店舗名なし）")}</div>
      <div class="mini-sub">${[opts.showDate && fmtDateJa(v.visitDate), placeOf(v), industryOf(v), personOf(v) && `👤 ${personOf(v)}`].filter(Boolean).map(esc).join(" · ")}</div>
    </div>
    <div class="btn-row" style="margin:0">${st.html}
      ${maps ? `<a class="btn small" href="${esc(maps)}" target="_blank" rel="noopener">地図</a>` : ""}
      ${demoLinksHtml(v.demoUrl || itemVal(v.items, "demoUrl"))}
      ${st.done ? "" : `<button class="btn small primary" type="button" data-report-visit="${esc(v.id)}">報告する</button>`}
    </div>
  </div>`;
}
let schedMode = "0"; // "0"=今日 "1"=明日 "pick"=日付を選ぶ
const schedDay = () => (schedMode === "1" ? tomorrow() : schedMode === "pick" ? ($("#schedDate").value || today()) : today());
$("#todaySeg").addEventListener("click", (e) => {
  const b = e.target.closest("[data-day]");
  if (!b) return;
  schedMode = b.dataset.day;
  if (schedMode === "pick" && !$("#schedDate").value) $("#schedDate").value = today();
  renderToday();
});
$("#schedDate").addEventListener("change", () => { schedMode = "pick"; renderToday(); });
["#schedPerson", "#schedIndustry", "#schedStatus"].forEach((id) => $(id).addEventListener("change", renderToday));
$("#schedClear").addEventListener("click", () => { $("#schedPerson").value = "__me"; $("#schedIndustry").value = ""; $("#schedStatus").value = ""; renderToday(); });

/* 予定の絞り込み用の選択肢（担当者・業種） */
function refreshSchedOptions() {
  const p = $("#schedPerson"), i = $("#schedIndustry");
  const curP = p.value ?? "__me", curI = i.value;
  const names = [...new Set(visits.map(personOf).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
  p.innerHTML = `<option value="__me">自分${myName ? `（${esc(myName)}）` : ""}</option><option value="">全員</option>` +
    names.filter((n) => n !== myName).map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join("") + `<option value="${NO_PERSON}">担当者なし</option>`;
  p.value = [...p.options].some((o) => o.value === curP) ? curP : "__me";
  i.innerHTML = `<option value="">すべての業種</option>` + INDUSTRIES.map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join("") + `<option value="${NO_PERSON}">業種 未入力</option>`;
  i.value = [...i.options].some((o) => o.value === curI) ? curI : "";
}
const industryMatch = (v, f) => !f || (f === NO_PERSON ? !industryOf(v) : industryOf(v) === f);

function renderToday() {
  if (!currentUser || !$("#todayVisits")) return;
  const t = today();
  const day = schedDay();
  const dayWord = schedMode === "0" ? "今日" : schedMode === "1" ? "明日" : fmtDateJa(day);
  document.querySelectorAll("#todaySeg .seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.day === schedMode));
  $("#schedDate").classList.toggle("hidden", schedMode !== "pick");
  refreshSchedOptions();
  const pF = $("#schedPerson").value, iF = $("#schedIndustry").value, stF = $("#schedStatus").value;
  $("#schedClear").classList.toggle("hidden", pF === "__me" && !iF && !stF);
  $("#todayTitle").textContent = schedMode === "pick" ? `${fmtDateJa(day)}の予定` : `${dayWord}の予定（${fmtDateJa(day)}）`;
  const mine = visits.filter((v) => v.visitDate === day && personMatch(v, pF) && industryMatch(v, iF)
      && (!stF || (stF === "done") === visitStatus(v).done))
    .sort((a, b) => timeOf(a).localeCompare(timeOf(b)) || caseNum(a) - caseNum(b));
  const who = pF === "__me" ? "自分の" : pF === "" ? "全員の" : pF === NO_PERSON ? "担当者なしの" : `${pF}さんの`;
  const route = mapsDirUrl(mine);
  $("#todayVisits").innerHTML = mine.length
    ? `<p class="hint">${who}訪問 ${mine.length}件（報告済み ${mine.filter((v) => visitStatus(v).done).length}件）</p>` +
      mine.map((v) => visitMiniHtml(v)).join("") +
      (route ? `<div class="btn-row"><a class="btn" href="${esc(route)}" target="_blank" rel="noopener">🗺 この予定のルートをGoogleマップで開く</a></div>` : "")
    : `<p class="empty">${esc(dayWord)}の${esc(who)}訪問予定はありません${pF === "__me" && !myName ? "<br><small>右上の「👤 名前」で自分の名前を固定すると、自分の予定が表示されます</small>" : ""}${pF || iF || stF ? "<br><small>絞り込みを変えると、ほかの予定も見られます</small>" : ""}</p>`;

  // 次回アクション：自分の報告で、予定日が今日まで・未対応のもの
  const acts = reports.filter((r) => isMyReport(r) && !r.naDone).map((r) => {
    const na = naItemsOf(r);
    const d = firstOfType(na, ["date", "datetime"]).slice(0, 10);
    return { r, d, text: firstOfType(na, ["textarea", "text"]), maps: firstOfType(na, ["maps"]) };
  }).filter((x) => x.d && x.d <= t).sort((a, b) => a.d.localeCompare(b.d));
  $("#todayActions").innerHTML = acts.length ? acts.map((x) => `
    <div class="mini-row">
      <div class="mini-main">
        <div class="mini-title">${x.d < t ? '<span class="due over">期限切れ</span>' : '<span class="due now">今日</span>'} ${esc(reportTitle(x.r))}</div>
        <div class="mini-sub">${esc(fmtDateJa(x.d))}${x.text ? ` · ${esc(x.text)}` : ""}</div>
      </div>
      <div class="btn-row" style="margin:0">
        ${x.maps ? `<a class="btn small" href="${esc(x.maps)}" target="_blank" rel="noopener">地図</a>` : ""}
        <button class="btn small primary" type="button" data-na-done="${esc(x.r.id)}">対応済みにする</button>
      </div>
    </div>`).join("") : `<p class="empty">期限が来ている次回アクションはありません</p>`;

  // 報告漏れ：自分の訪問で、訪問日が今日まで（直近14日）・未報告のもの
  const from = ymd(new Date(Date.now() - 14 * 864e5));
  const missing = visits.filter((v) => isMine(v) && v.visitDate && v.visitDate <= t && v.visitDate >= from && !visitStatus(v).done)
    .sort((a, b) => (a.visitDate || "").localeCompare(b.visitDate || ""));
  $("#todayMissing").innerHTML = missing.length
    ? `<p class="hint">直近2週間で、まだ完了報告をしていない訪問が ${missing.length}件あります</p>` + missing.map((v) => visitMiniHtml(v, { showDate: true })).join("")
    : `<p class="empty">報告漏れはありません 👍</p>`;
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-na-done]");
  if (!b) return;
  try {
    const r = reports.find((x) => x.id === b.dataset.naDone);
    const naAfter = { naDone: true, nextActionItems: naItemsOf(r) };
    await updateDoc(doc(db, "reports", b.dataset.naDone), { ...naAfter, updatedAt: serverTimestamp() });
    if (r) recordHistory({ label: "次回アクションの対応済み", col: "reports", id: r.id, before: { naDone: r.naDone === true, nextActionItems: clone(r.nextActionItems || []) }, after: clone(naAfter) });
    toast("次回アクションを対応済みにしました");
  } catch (err) { showBanner(err, "次回アクションの更新"); }
});

/* ---------- 同じ店舗の重複チェック ---------- */
function duplicateNote(row, info) {
  const mapsField = formats.visit.find((f) => f.type === "maps");
  const url = row.querySelector(`[data-field-id="${CSS.escape(mapsField?.id || "")}"]`)?.value.trim();
  const name = (info?.name || "").replace(/\s/g, "");
  const city = info?.city || info?.ward || "";
  const hits = visits.filter((v) => {
    if (editingVisitId && v.id === editingVisitId) return false;
    const vu = (v.items || []).find((i) => i.type === "maps")?.value?.trim();
    const vn = textOf(v, "shopName").replace(/\s/g, "");
    return (url && vu === url) || (name && vn === name && (!city || placeOf(v).includes(city)));
  }).sort((a, b) => caseNum(b) - caseNum(a));
  if (!hits.length) return "";
  const v = hits[0];
  const st = visitStatus(v);
  return `⚠ 以前にも登録あり：${v.caseNo || ""}（${fmtDateJa(v.visitDate)}${personOf(v) ? `・${personOf(v)}` : ""}${st.done ? `・結果：${st.result || "報告済み"}` : "・未報告"}）${hits.length > 1 ? ` ほか${hits.length - 1}件` : ""}`;
}

/* ---------- 写真（端末で小さくしてから保存） ---------- */
async function compressImage(file, max = 1280, quality = 0.7) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, ng) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ng; i.src = url; });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    let q = quality, data = c.toDataURL("image/jpeg", q);
    while (data.length > 850000 && q > 0.3) { q -= 0.15; data = c.toDataURL("image/jpeg", q); }
    return data;
  } finally { URL.revokeObjectURL(url); }
}
const photoCache = new Map();
async function loadPhoto(id) {
  if (photoCache.has(id)) return photoCache.get(id);
  const s = await getDoc(doc(db, "photos", id));
  const d = s.exists() ? s.data().data : "";
  photoCache.set(id, d);
  return d;
}
function hydratePhotos(root = document) {
  root.querySelectorAll("img[data-photo]:not([src])").forEach(async (img) => {
    try { const d = await loadPhoto(img.dataset.photo); if (d) img.src = d; else img.alt = "（削除された写真）"; }
    catch { img.alt = "（写真を読み込めません）"; }
  });
}
new MutationObserver(() => hydratePhotos()).observe(document.body, { childList: true, subtree: true });
function photoThumbs(ids, removable = false) {
  return ids.filter(Boolean).map((id) => `<span class="ph"><img data-photo="${esc(id)}" alt="写真">${removable ? `<button type="button" class="ph-x" data-ph-remove="${esc(id)}" aria-label="写真を外す">×</button>` : ""}</span>`).join("");
}
document.addEventListener("change", async (e) => {
  const input = e.target.closest("input[data-photo-input]");
  if (!input) return;
  const wrap = input.closest(".photo-field");
  const hidden = wrap.querySelector("[data-field-id]");
  const files = [...input.files].slice(0, 6);
  input.value = "";
  const status = wrap.querySelector(".ph-status");
  for (const [n, f] of files.entries()) {
    status.textContent = `写真を保存中…（${n + 1}/${files.length}）`;
    try {
      const data = await compressImage(f);
      const ref = await addDoc(collection(db, "photos"), { data, ownerUid: currentUser.uid, createdAt: serverTimestamp() });
      photoCache.set(ref.id, data);
      hidden.value = [...hidden.value.split(",").filter(Boolean), ref.id].join(",");
      wrap.querySelector(".ph-list").innerHTML = photoThumbs(hidden.value.split(","), true);
    } catch (err) { showBanner(err, "写真の保存"); }
  }
  status.textContent = "";
  saveDraftsSoon();
});
document.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-ph-remove]");
  if (!b) return;
  const wrap = b.closest(".photo-field");
  const hidden = wrap.querySelector("[data-field-id]");
  hidden.value = hidden.value.split(",").filter((x) => x && x !== b.dataset.phRemove).join(",");
  wrap.querySelector(".ph-list").innerHTML = photoThumbs(hidden.value.split(","), true);
  saveDraftsSoon();
});

/* ---------- 下書きの自動保存（端末に保存。保存に成功したら消える） ---------- */
const draftKey = (k) => `dc-draft-${k}-${currentUser?.uid || "x"}`;
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(draftKey(k)) || "null"); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(draftKey(k), JSON.stringify(v)); } catch { /* 容量不足などは無視 */ } },
  del(k) { try { localStorage.removeItem(draftKey(k)); } catch { /* noop */ } }
};
let draftTimer;
function saveDraftsSoon() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    if (!currentUser) return;
    if (!editingId && document.querySelector("#reportCases .case-card")) {
      syncCases();
      const filled = reportCases.some((c) => Object.entries(c.v).some(([k, x]) => x && k !== "personName") || Object.values(c.na).some(Boolean));
      filled ? store.set("report", { cases: reportCases, at: Date.now() }) : store.del("report");
    }
    if (!editingVisitId) {
      syncVisitRows();
      visitRows.length ? store.set("visits", { rows: visitRows, date: $("#visitDate").value, at: Date.now() }) : store.del("visits");
    }
  }, 600);
}
document.addEventListener("input", (e) => { if (e.target.closest("#reportForm, #visitForm")) saveDraftsSoon(); });
document.addEventListener("change", (e) => { if (e.target.closest("#reportForm, #visitForm")) saveDraftsSoon(); });
let draftsRestored = false;
function restoreDrafts() {
  if (draftsRestored) return;
  draftsRestored = true;
  setTimeout(() => {
    const r = store.get("report");
    if (r?.cases?.length && !editingId) {
      reportCases = r.cases;
      renderReportForm();
      toast(`完了報告の下書き（${new Date(r.at).toLocaleString("ja-JP")}）を復元しました`);
    }
    const v = store.get("visits");
    if (v?.rows?.length && !editingVisitId) {
      visitRows = v.rows;
      if (v.date) $("#visitDate").value = v.date;
      renderVisitRows();
      toast(`訪問リストの下書き（${v.rows.length}件）を復元しました`);
    }
  }, 1200);
}

/* ---------- CSV出力（Excelで開ける） ---------- */
function downloadCsv(name, rows) {
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const tsText = (ts) => (ts?.toDate ? ts.toDate().toLocaleString("ja-JP") : "");
const cellOf = (i) => (i.type === "photo" ? (i.value ? `写真${i.value.split(",").filter(Boolean).length}枚` : "") : i.value);
$("#exportReports").addEventListener("click", () => {
  const labels = [...new Set(reports.flatMap((r) => (r.items || []).map((i) => i.label)))];
  const naLabels = [...new Set(reports.flatMap((r) => naItemsOf(r).map((i) => i.label)))];
  const rows = [["登録日時", "入力者", ...labels, ...naLabels.map((l) => `次回:${l}`), "次回対応済み"]];
  reports.forEach((r) => {
    const by = Object.fromEntries((r.items || []).map((i) => [i.label, cellOf(i)]));
    const na = Object.fromEntries(naItemsOf(r).map((i) => [i.label, i.value]));
    rows.push([tsText(r.createdAt), r.authorEmail, ...labels.map((l) => by[l] || ""), ...naLabels.map((l) => na[l] || ""), r.naDone ? "済" : ""]);
  });
  downloadCsv(`完了報告_${today()}.csv`, rows);
});
$("#exportVisits").addEventListener("click", () => {
  const labels = [...new Set(visits.flatMap((v) => (v.items || []).map((i) => i.label)))];
  const rows = [["案件番号", "訪問日", "報告", "登録日時", "入力者", ...labels, "デモサイトURL（自動登録）"]];
  [...visits].sort((a, b) => caseNum(a) - caseNum(b)).forEach((v) => {
    const by = Object.fromEntries((v.items || []).map((i) => [i.label, cellOf(i)]));
    const st = visitStatus(v);
    rows.push([v.caseNo || "", v.visitDate || "", st.done ? `済（${st.result || ""}）` : "未", tsText(v.createdAt), v.authorEmail, ...labels.map((l) => by[l] || ""), v.demoUrl || ""]);
  });
  downloadCsv(`訪問リスト_${today()}.csv`, rows);
});

/* ---------- 集計（管理者のみ） ---------- */
const monthOf = (s) => (s || "").slice(0, 7);
const reportDay = (r) => (r.createdAt?.toDate ? ymd(r.createdAt.toDate()) : today());
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00`); x.setDate(x.getDate() + n); return ymd(x); };
const weekStart = (d) => { const x = new Date(`${d}T00:00:00`); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return ymd(x); }; // 月曜はじまり
const lastOfMonth = (m) => { const [y, mo] = m.split("-").map(Number); return ymd(new Date(y, mo, 0)); };
let statsAnchor = null; // 見ている日（単位に合わせて週・月・年に直す）
const anchor = () => statsAnchor || today();

/* いまの単位と日付から 期間 {from, to, text} を作る */
function statsRange() {
  const unit = $("#statsUnit").value;
  const d = anchor();
  if (unit === "day") return { unit, from: d, to: d, text: fmtDateJa(d) };
  if (unit === "week") { const f = weekStart(d), t = addDays(f, 6); return { unit, from: f, to: t, text: `${fmtDateJa(f)} 〜 ${fmtDateJa(t)}` }; }
  if (unit === "month") { const m = monthOf(d); return { unit, from: `${m}-01`, to: lastOfMonth(m), text: `${m.replace("-", "年")}月` }; }
  if (unit === "year") { const y = d.slice(0, 4); return { unit, from: `${y}-01-01`, to: `${y}-12-31`, text: `${y}年` }; }
  if (unit === "custom") {
    let f = $("#statsFrom").value || addDays(today(), -6), t = $("#statsTo").value || today();
    if (f > t) [f, t] = [t, f];
    return { unit, from: f, to: t, text: `${fmtDateJa(f)} 〜 ${fmtDateJa(t)}` };
  }
  return { unit: "all", from: "0000-00-00", to: "9999-99-99", text: "全期間" };
}
function syncStatsInputs() {
  const unit = $("#statsUnit").value;
  const d = anchor();
  const show = (sel, on) => $(sel).classList.toggle("hidden", !on);
  show("#statsDay", unit === "day"); show("#statsMonthIn", unit === "month"); show("#statsYear", unit === "year");
  show("#statsFrom", unit === "custom"); show("#statsTo", unit === "custom"); show("#statsTilde", unit === "custom");
  show("#statsPrev", ["day", "week", "month", "year"].includes(unit)); show("#statsNext", ["day", "week", "month", "year"].includes(unit));
  show("#statsNow", unit !== "all" && unit !== "custom");
  $("#statsRangeText").classList.toggle("hidden", !["week", "all"].includes(unit));
  if (unit === "day") $("#statsDay").value = d;
  if (unit === "month") $("#statsMonthIn").value = monthOf(d);
  if (unit === "year") {
    const thisY = Number(today().slice(0, 4));
    const years = new Set([thisY, Number(d.slice(0, 4)), ...visits.map((v) => Number((v.visitDate || "").slice(0, 4))), ...reports.map((r) => Number(reportDay(r).slice(0, 4)))].filter(Boolean));
    $("#statsYear").innerHTML = [...years].sort((x, y) => y - x).map((y) => `<option value="${y}">${y}年</option>`).join("");
    $("#statsYear").value = d.slice(0, 4);
  }
  if (unit === "custom" && !$("#statsFrom").value) { $("#statsFrom").value = addDays(today(), -6); $("#statsTo").value = today(); }
}
function stepStats(n) {
  const unit = $("#statsUnit").value, d = anchor();
  if (unit === "day") statsAnchor = addDays(d, n);
  else if (unit === "week") statsAnchor = addDays(d, 7 * n);
  else if (unit === "month") { const x = new Date(`${d.slice(0, 7)}-01T00:00:00`); x.setMonth(x.getMonth() + n); statsAnchor = ymd(x); }
  else if (unit === "year") statsAnchor = `${Number(d.slice(0, 4)) + n}-01-01`;
  renderStats();
}
$("#statsUnit").addEventListener("change", renderStats);
$("#statsPrev").addEventListener("click", () => stepStats(-1));
$("#statsNext").addEventListener("click", () => stepStats(1));
$("#statsNow").addEventListener("click", () => { statsAnchor = null; renderStats(); });
$("#statsDay").addEventListener("change", (e) => { if (e.target.value) { statsAnchor = e.target.value; renderStats(); } });
$("#statsMonthIn").addEventListener("change", (e) => { if (e.target.value) { statsAnchor = `${e.target.value}-01`; renderStats(); } });
$("#statsYear").addEventListener("change", (e) => { statsAnchor = `${e.target.value}-01-01`; renderStats(); });
$("#statsFrom").addEventListener("change", renderStats);
$("#statsTo").addEventListener("change", renderStats);

function statTable(rows, keyLabel) {
  if (!rows.length) return `<p class="empty">データがありません</p>`;
  const maxV = Math.max(1, ...rows.map((r) => r.visits));
  return `<div class="stat-table"><div class="st-head"><span>${keyLabel}</span><span>訪問</span><span>報告</span><span>成約</span><span>成約率</span></div>` +
    rows.map((r) => `<div class="st-row"><span class="st-key">${esc(r.key)}</span>
      <span><i class="bar" style="width:${Math.round((r.visits / maxV) * 60)}px"></i>${r.visits}</span>
      <span>${r.reports}</span><span class="st-won">${r.won}</span>
      <span>${r.reports ? Math.round((r.won / r.reports) * 100) : 0}%</span></div>`).join("") + "</div>";
}
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

/* 数字の日報：件数だけを並べる（結果ごとの件数・成約率・次回アクション） */
function dailyNumbers(from, to, vs, rs) {
  const results = [...new Set([...(formats.report.find((f) => f.id === "result")?.options || []), ...rs.map((r) => itemVal(r.items, "result")).filter(Boolean)])];
  const cnt = (list) => Object.fromEntries(results.map((k) => [k, list.filter((r) => itemVal(r.items, "result") === k).length]));
  return { results, cnt };
}
function dailyText(range, vs, rs) {
  const { results, cnt } = dailyNumbers(range.from, range.to, vs, rs);
  const c = cnt(rs);
  const won = c["成約"] || 0;
  const pending = rs.filter((r) => !r.naDone && firstOfType(naItemsOf(r), ["date", "datetime"])).length;
  const people = {};
  const P = (n) => (people[n || "（担当者なし）"] ||= { v: 0, r: 0, w: 0 });
  vs.forEach((v) => P(personOf(v)).v++);
  rs.forEach((r) => { const x = P(reportPerson(r)); x.r++; if (itemVal(r.items, "result") === "成約") x.w++; });
  return [
    `【日報】${range.text}`,
    `訪問予定：${vs.length}件`,
    `完了報告：${rs.length}件`,
    `成約：${won}件（成約率 ${pct(won, rs.length)}%）`,
    results.filter((k) => k !== "成約").map((k) => `${k}：${c[k] || 0}件`).join("　"),
    `報告漏れ（訪問−報告）：${Math.max(0, vs.length - rs.length)}件`,
    `次回アクション（未対応）：${pending}件`,
    "",
    "■担当者別（訪問／報告／成約）",
    ...Object.entries(people).sort((a, b) => b[1].w - a[1].w || b[1].r - a[1].r).map(([n, x]) => `${n}：${x.v}／${x.r}／${x.w}`)
  ].filter((l, i, arr) => !(l === "" && i === 4)).join("\n");
}
let lastDaily = "";

function renderStats() {
  if (!isAdmin() || !$("#statsPerson")) return;
  syncStatsInputs();
  const range = statsRange();
  $("#statsRangeText").textContent = range.text;
  const inP = (d) => !!d && d >= range.from && d <= range.to;
  const vs = visits.filter((v) => inP(v.visitDate));
  const rs = reports.filter((r) => inP(reportDay(r)));
  const won = (r) => itemVal(r.items, "result") === "成約";
  const group = (keyV, keyR) => {
    const m = {};
    const g = (k) => (m[k] ||= { key: k, visits: 0, reports: 0, won: 0 });
    vs.forEach((v) => g(keyV(v) || "（未設定）").visits++);
    rs.forEach((r) => { const x = g(keyR(r) || "（未設定）"); x.reports++; if (won(r)) x.won++; });
    return Object.values(m).sort((a, b) => b.won - a.won || b.reports - a.reports || b.visits - a.visits);
  };
  const totalWon = rs.filter(won).length;
  $("#statsSummary").innerHTML = `<div><b>${vs.length}</b><small>訪問</small></div><div><b>${rs.length}</b><small>報告</small></div><div class="st-won"><b>${totalWon}</b><small>成約</small></div><div><b>${pct(totalWon, rs.length)}%</b><small>成約率</small></div>`;

  // 日報（数字）：日ごとの件数表（最大31日）＋コピー用の文章
  const { results, cnt } = dailyNumbers(range.from, range.to, vs, rs);
  const days = [...new Set([...vs.map((v) => v.visitDate), ...rs.map(reportDay)].filter(Boolean))].sort().reverse().slice(0, 31);
  $("#statsDaily").innerHTML = days.length ? `<div class="stat-table daily" style="--cols:${results.length + 2}">
    <div class="st-head"><span>日付</span><span>訪問</span><span>報告</span>${results.map((k) => `<span>${esc(k)}</span>`).join("")}</div>` +
    days.map((d) => {
      const dv = vs.filter((v) => v.visitDate === d), dr = rs.filter((r) => reportDay(r) === d), c = cnt(dr);
      return `<div class="st-row"><span class="st-key">${esc(fmtDateJa(d))}</span><span>${dv.length}</span><span>${dr.length}</span>${results.map((k) => `<span${k === "成約" ? ' class="st-won"' : ""}>${c[k] || 0}</span>`).join("")}</div>`;
    }).join("") + "</div>" : `<p class="empty">この期間のデータがありません</p>`;
  lastDaily = dailyText(range, vs, rs);

  $("#statsPerson").innerHTML = statTable(group(personOf, reportPerson), "担当者");
  const reportPlace = (r) => {
    const v = visitOfReport(r);
    if (!v) return "";
    const p = placeParts(v);
    return [p.prefecture, p.city || p.ward].join("");
  };
  $("#statsArea").innerHTML = statTable(group((v) => { const p = placeParts(v); return [p.prefecture, p.city || p.ward].join(""); }, reportPlace), "地域");

  // 推移：期間の大きさに合わせて 日別／月別／年別
  const spanDays = range.unit === "all" ? 9999 : Math.round((new Date(range.to) - new Date(range.from)) / 864e5) + 1;
  const bucket = spanDays <= 62 ? [(d) => d, (k) => fmtDateJa(k), "日別"] : spanDays <= 800 ? [monthOf, (k) => k.replace("-", "年") + "月", "月別"] : [(d) => d.slice(0, 4), (k) => k + "年", "年別"];
  $("#statsTrendTitle").textContent = `${bucket[2]}の推移`;
  const tr = {};
  const T = (k) => (tr[k] ||= { key: k, visits: 0, reports: 0, won: 0 });
  vs.forEach((v) => { const k = bucket[0](v.visitDate); if (k) T(k).visits++; });
  rs.forEach((r) => { const k = bucket[0](reportDay(r)); if (k) { const x = T(k); x.reports++; if (won(r)) x.won++; } });
  $("#statsMonth").innerHTML = statTable(Object.values(tr).sort((a, b) => b.key.localeCompare(a.key)).slice(0, 62).map((x) => ({ ...x, key: bucket[1](x.key) })), bucket[2].replace("別", ""));
}
$("#copyDaily").addEventListener("click", () => { if (lastDaily) copyText(lastDaily); });

/* ---------- 訪問先の読み取り直し（管理者） ---------- */
const visitNeedsRepair = (v) => {
  const sn = textOf(v, "shopName");
  const hasMaps = (v.items || []).some((i) => i.type === "maps" && i.value);
  if (!hasMaps) return false;
  return /[\n〒]/.test(sn) || sn.length > 40 || !textOf(v, "prefecture") || !INDUSTRIES.includes(catOf(v));
};
$("#repairVisits").addEventListener("click", async () => {
  if (!isAdmin()) return;
  const targets = visits.filter(visitNeedsRepair);
  const out = $("#repairResult");
  if (!targets.length) { out.textContent = "読み取り直しが必要な訪問先はありません。"; return; }
  if (!confirm(`${targets.length}件の訪問先を、Googleマップから読み取り直します。店舗名・県・市・区・業種・営業時間が上書きされます。よろしいですか？`)) return;
  const btn = $("#repairVisits");
  btn.disabled = true;
  let ok = 0, ng = 0;
  for (const [n, v] of targets.entries()) {
    out.textContent = `読み取り中… ${n + 1} / ${targets.length}`;
    try {
      const url = (v.items.find((i) => i.type === "maps" && i.value) || {}).value;
      lookupCache.delete(url);
      const info = await mapsLookup(url);
      if (!info.ok) { ng++; continue; }
      const items = clone(v.items);
      // フォーマットの項目ごとに、マップの情報を入れる（無い項目は足す）
      formats.visit.filter((f) => f.type !== "maps").forEach((f) => {
        const key = LOOKUP_MAP[f.id] || autoKeyByLabel(f.label, f.type);
        if (!key || !info[key]) return;
        let it = items.find((i) => i.id === f.id);
        if (!it) { it = { id: f.id, label: f.label, type: f.type, value: "" }; items.push(it); }
        it.value = info[key];
      });
      await updateDoc(doc(db, "visits", v.id), { items, updatedAt: serverTimestamp(), updatedBy: currentUser.email });
      ok++;
    } catch { ng++; }
  }
  btn.disabled = false;
  out.textContent = `完了：${ok}件を直しました${ng ? `（${ng}件は読み取れませんでした。カードの「編集」から手で直してください）` : ""}。`;
});

/* ---------- Claude Code：まとめて依頼 ---------- */
$("#copyClaudeBatch").addEventListener("click", () => {
  const t = tomorrow();
  const list = visits.filter((v) => v.visitDate === t).sort((a, b) => caseNum(a) - caseNum(b));
  const items = list.map((v) => ({ v, maps: (v.items || []).find((i) => i.type === "maps" && i.value)?.value })).filter((x) => x.maps);
  if (!items.length) { toast("明日の訪問先にGoogleマップのリンクがありません"); return; }
  const text = [
    `次の${items.length}件のGoogleマップのリンクから、それぞれデモサイトを作ってください。`,
    `作り終わったら、1件ずつ次のコマンドで公開URLを登録してください（「合言葉」の部分は INTEGRATION_TOKEN の値に置き換え）。`,
    `curl -sS -X POST ${location.origin}/api/demo-url -H "Content-Type: application/json" -d '{"caseNo":"案件番号","url":"公開URL","token":"合言葉"}'`,
    "",
    ...items.map(({ v, maps }) => `${v.caseNo}　${textOf(v, "shopName")}（${placeOf(v)}）\n${maps}`)
  ].join("\n");
  copyText(text);
});

/* ---------- まとめて再描画 ---------- */
function renderAllExtras() {
  if (!$("#tab-today").classList.contains("hidden")) renderToday();
  if (!$("#tab-stats").classList.contains("hidden")) renderStats();
  if (isAdmin()) renderMembers();
}


/* ---------- Claude Codeで登録されたデモサイトURL（Netlify側に保存）を訪問先に付ける ---------- */
// 保存した訪問先のGoogleマップのリンクを、デモサイト作成の依頼として預ける（Claude Codeが定期的に受け取って作る）
async function queueDemos(list) {
  try {
    const items = list.map(({ caseNo, visitDate, items }) => {
      const o = { caseNo, visitDate };
      for (const i of items || []) if (i.value) o[i.id] = i.value;
      return o;
    }).filter((o) => o.caseNo && o.mapsUrl);
    if (!items.length) return;
    const t = await currentUser.getIdToken();
    await fetch("/api/demo-queue", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
      body: JSON.stringify({ items })
    });
  } catch (e) { console.warn("デモ作成の依頼に失敗しました", e); }
}

let demoUrls = {};
let demoTimer = null;
function applyDemoUrls() {
  visits.forEach((v) => {
    const d = v.caseNo && demoUrls[String(v.caseNo).toUpperCase()];
    if (d?.url) v.demoUrl = d.url;
  });
}
async function loadDemoUrls() {
  clearTimeout(demoTimer);
  if (!currentUser) return;
  try {
    const t = await currentUser.getIdToken();
    const r = await fetch("/api/demo-url", { headers: { Authorization: `Bearer ${t}` }, cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      const before = JSON.stringify(demoUrls);
      demoUrls = j.items || {};
      if (JSON.stringify(demoUrls) !== before) { applyDemoUrls(); renderList(); renderVisitList(); renderAllExtras(); }
    }
  } catch { /* 取得できなくてもアプリは使える */ }
  demoTimer = setTimeout(loadDemoUrls, 5 * 60 * 1000); // 5分ごとに確認
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && dataLoaded) loadDemoUrls(); });
