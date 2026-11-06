# このリポジトリでの作業ルール

- UI（`public/index.html` / `public/style.css` / `public/app.js` の画面部分）を変えるときは、必ず `DESIGN.md` のデザインの決まりに合わせる。
  - 黒ベース＋5色のアクセント、白地に黒文字のメインボタン、線のSVGアイコン（`ic("名前")`）。
  - 絵文字・記号文字（✓ ⚠ など）は使わない。
- 画面のファイルを変えたら `public/sw.js` の `CACHE` の番号を上げる。
