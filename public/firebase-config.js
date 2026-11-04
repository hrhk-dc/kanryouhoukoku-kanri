// Firebaseプロジェクト「dc-report」（dc-report-8e1d1）のウェブアプリ設定
export const firebaseConfig = {
  apiKey: "AIzaSyC7DblMiGT1f5bM9eIVka4xjndbi1cKpOc",
  // 本番（pages.dev）では、このサイト自身をログインの窓口にする（スマホのChrome対策。/__/auth を中継している）
  authDomain: /\.pages\.dev$/.test(location.hostname) ? location.host : "dc-report-8e1d1.firebaseapp.com",
  projectId: "dc-report-8e1d1",
  storageBucket: "dc-report-8e1d1.firebasestorage.app",
  messagingSenderId: "380576281192",
  appId: "1:380576281192:web:5b0b60db9f045b85f981dd"
};
