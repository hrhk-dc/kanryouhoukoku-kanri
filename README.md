# DC 完了報告（kanryouhoukoku-kanri）

株式会社DCの完了報告・翌日訪問リストのアプリです。

- アプリ：https://kanryouhoukoku-kanri.pages.dev/
- このリポジトリの `main` ブランチに変更を入れると、Cloudflare Pages が自動で公開します（ビルドなし・公開フォルダは `public`）。

## ファイル構成
| ファイル | 内容 |
|---|---|
| `public/` | 公開される画面のファイル一式（`index.html` / `style.css` / `app.js` など） |
| `public/firebase-config.js` | Firebase（dc-report-8e1d1）の接続設定（公開して問題ない値） |
| `firestore.rules` | データベースの権限ルール（変更したら Firebase コンソールで公開が必要） |
| `functions/api/maps-info.js` | Googleマップのリンクから店舗情報を読み取る |
| `functions/api/demo-url.js` | Claude Code で作ったデモサイトURLを案件に登録する（Cloudflare KV に保存） |
| `public/manifest.webmanifest` / `public/sw.js` / `public/icons/` | ホーム画面アプリ化 |
| `public/_headers` | 公開時のヘッダー設定（セキュリティ・キャッシュ） |
| `管理者向けメモ.md` | メンバー許可・APIキー・連携の設定手順 |

## 秘密の情報について
APIキーや合言葉（INTEGRATION_TOKEN）は、このリポジトリには入れず、Cloudflare Pages の環境変数（Settings → Variables and Secrets）に設定します（`管理者向けメモ.md` 参照）。
