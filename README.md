# DC 完了報告（kanryouhoukoku-kanri）

株式会社DCの完了報告・翌日訪問リストのアプリです。

- アプリ：https://dc-houkoku.netlify.app/
- このリポジトリの `main` ブランチに変更を入れると、Netlify が自動で公開します（zip のドロップは不要）。

## ファイル構成
| ファイル | 内容 |
|---|---|
| `public/` | 公開される画面のファイル一式（`index.html` / `style.css` / `app.js` など） |
| `public/firebase-config.js` | Firebase（dc-report-8e1d1）の接続設定（公開して問題ない値） |
| `firestore.rules` | データベースの権限ルール（変更したら Firebase コンソールで公開が必要） |
| `netlify/functions/maps-info.mjs` | Googleマップのリンクから店舗情報を読み取る |
| `netlify/functions/demo-url.mjs` | Claude Code で作ったデモサイトURLを案件に登録する（Netlify Blobs に保存） |
| `public/manifest.webmanifest` / `public/sw.js` / `public/icons/` | ホーム画面アプリ化 |
| `管理者向けメモ.md` | メンバー許可・APIキー・連携の設定手順 |

## 秘密の情報について
APIキーや合言葉（INTEGRATION_TOKEN）は、このリポジトリには入れず、Netlify の環境変数に設定します（`管理者向けメモ.md` 参照）。
