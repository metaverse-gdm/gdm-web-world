# GDM World

ゲーム、ツール、アプリなどの作品を集める P2P カタログです。静的サイトとして https://gdm.tik-choco.com/worlds/ で公開します。一覧の検索・タグ絞り込み、作品詳細、承認申請、投稿・編集・削除をブラウザーから利用できます。投稿や承認には Ed25519 の `did:key` で署名します。

## 起動

Node.js 24 と npm を使用します。HTTPS または `localhost` で開いてください。

```sh
npm install
npm run dev
```

Windows PowerShell で npm のスクリプト実行が制限されている場合は `npm.cmd` を使用できます。

```sh
node node_modules/typescript/bin/tsc -b
node node_modules/eslint/bin/eslint.js .
node node_modules/vitest/vitest.mjs run
node node_modules/vite/bin/vite.js build
```

ビルドとローカル起動時の既定のベースパスは `/worlds/` です（`VITE_BASE_PATH` で変更可）。

### デプロイ（FTPS）

tc-game と同じ方式で、`dist/` のうち前回から変わったファイルだけを FTPS でアップロードします。

1. `.env.example` を `.env` にコピーし、`FTPS_HOST` / `FTPS_USER` / `FTPS_REMOTE_DIR`（既定 `/gdm/worlds`）と `VITE_ROOT_ADMIN_DIDS` を設定します。
2. `just ftps-login` でパスワードを保存します（Windows の DPAPI で暗号化、tc-game / tc-linkai と共有）。
3. `develop` ブランチで変更をコミットしてから `just deploy`（`guru merge main` で develop を main にマージ・push して develop に戻り、ビルドしてアップロード。ブランチは削除しない）。確認だけなら `just deploy --dry`（この場合もマージは行われる）。

## 最初の管理者を設定

1. アプリを開き、管理者にするユーザーの DID をヘッダーからコピーします。mistl と連携している場合は mistl のルート DID が表示されます。
2. `.env.example` を `.env` にコピーし、`VITE_ROOT_ADMIN_DIDS=did:key:…` を設定します。複数の DID はコンマで区切ります。ソースで設定する場合は `src/config.ts` の `builtInRoots` に追加します。両方の値は結合されます。
3. 開発サーバーを再起動するか、静的サイトを再ビルドします。デプロイ時は `.env` の `VITE_ROOT_ADMIN_DIDS` がビルドに埋め込まれます。

ブラウザー DID を使う場合は、公開先と同じオリジンで取得します。同じブラウザープロファイルとオリジン上の対応する tik-choco アプリはブラウザー DID を共有します。管理者の DID 一覧は公開設定です。同じカタログを使う配布物では設定を揃えます。既定の一覧は空です。

## mistl と連携

1. mistl を実行している端末で `mistl key pair` を実行します。
2. GDM World の **設定 → 高度な設定 → mistl と連携** を開き、表示されたペアリングコードを入力して **連携する** を押します。
3. 表示された mistl のルート DID をコピーし、管理者に送って承認を依頼します。管理者はルート DID を承認してください。同じ mistl に連携したブラウザーや端末で承認と作品の編集権限を共有できます。

コードで連携できない場合は、設定に表示されたブラウザー DID を使って `mistl key delegate --leaf <did:key>` を実行し、出力を **委譲JSONを貼り付け** に入力します。期限が近づいたら同じ mistl で再連携してください。連携を解除すると、このオリジン上の対応する tc アプリでも解除されます。連携前の投稿と承認は元のブラウザー DID に紐づきます。

## 承認と投稿

- ルート DID は常に管理者です。管理者は DID を **メンバー** または **管理者** として承認でき、ルート以外の承認を取り消せます。
- 承認を判定するたびに、発行者の現在の権限を評価し、有効な承認の連鎖がルートに到達することを確認します。発行時に発行者が管理者だったかどうかは判定条件から外しています。連鎖が循環して有効な権限を確定できない場合は、関係する不安定な権限を付与しません。
- 同じ DID への決定ではルートの記録が委任管理者の記録に優先します。同じ優先度では時刻の新しい決定が勝ち、同時刻の承認と取消しでは取消しが勝ちます。有効期限を過ぎた最新承認は失効します。
- 現在承認されている投稿者の作品が一覧に表示されます。承認を失った投稿者の作品は署名付き履歴に残り、再承認されると削除済みのものを除いて再表示されます。編集できるのは元の投稿者です。削除は投稿者または管理者が行えます。署名された時点の権限から確認できる削除記録も保持します。
- 承認申請は管理者画面だけに表示されます。申請メッセージは署名付きの公開ルーム通信です。入力は公開できる範囲に留めてください。申請は端末に別保存され、ピア間で同期します。

## カタログの保管

### P2P と端末ミラー

全員が `gdm-world-global` に参加します。署名の一覧を交換し、不足している記録を分割して受信します。受信側は個々の署名を確認し、承認・編集・削除の効果を自分で計算します。端末ミラーは mistlib の OPFS KV を優先し、利用できない場合に localStorage へ保存します。

作品の詳細ダイアログでは、投稿者と管理者が過去7日間と30日間の表示数・詳細を開いた回数・作品リンクのクリック数を確認できます。一覧でカードの半分以上が1秒以上表示されると、表示として記録されます。署名付きの `gdmw:stats` は、作品・UTC 日・指標ごとに閲覧者の DID を1回だけ数え、投稿者自身は集計から除きます。承認に関係なく閲覧者が参加できるため、新しい DID を作って数値を増やせます。記録は端末と公開 P2P ルームで共有し、90 UTC 日間保持します。

### 共有カタログ Vault

共有スコープは固定の `gdm-world-catalog-0173ebadfb432886a12466acc316b3139b825c29` です。投稿、削除、承認、取消し、プロフィールの署名付き履歴はすべて、mistl の escrow を使う単一の共有分散 Vault に保存されます。接続中のピアのうちノード ID が最小の端末が書き込みを担当します。プロバイダーに保存されたチェックポイントは、元のピアがオフラインでも復元できます。

1. **設定 → 高度な設定 → 分散保管庫** を開き、**mistl ルーム** をコピーします。既定の自動モードでは、アプリ ID と固定スコープから全ピアで同じルーム名が導出されます。
2. mistl 側でその名前を登録します。画面の「カタログのスコープ ID」や P2P ルーム名とは別の値です。

```sh
mistl escrow rooms add <room>
```

3. パネルでプロバイダーとの接続状態を確認し、必要なら手動で保存または復元します。

共有スコープから導出する鍵は公開です。誰でもチェックポイントを書ける設計なので、復元時にアプリが各レコードの署名を検証し、権限と削除を改めて判定します。既知の署名付き履歴は和集合で維持されます。新規端末が得られる履歴の完全性は、プロバイダーのチェックポイントと接続できるピアに依存します。

共有 Vault のモードやルームを変更できるのは、ルートを含む現在の管理者だけです。ピアはグローバルルーム向けの署名と送信者の現在の管理者権限を確認して設定を採用します。独自ルームの設定を新規端末に共有するには、設定を保持しているピアへの接続が必要です。設定の署名者が管理者権限を失った場合、適用済みの設定は端末上に残り、新規端末との共有には現在の管理者による設定更新が必要です。

### ローカル設定と画像

下書き・表示名の設定・テーマはブラウザーのローカルストレージに保存されます。承認済みのユーザーの表示名は、署名付きプロフィール（`gdmw:profile`）としてカタログで共有されます。プロフィールがない場合は最新の承認申請の表示名を使います。投稿者の表示名を選ぶと、DID の確認とコピーができます。

投稿のタイトル・概要・説明は日本語・英語・中国語で入力できます。署名付きレコードでは主言語を `lang` に、他の言語の本文を `translations` に保存します。表示言語の翻訳がなければ主言語の本文を表示します。

アップロードしたサムネイルはブラウザーで縮小して mistlib にピン留めし、署名付きレコードには `thumbnailCid` を保存します。HTTPS の画像を指定した場合は代わりに `thumbnailUrl` を保存します。画像を指定しない場合は、投稿先のページの画像メタデータまたは WordPress mshots のスクリーンショットを使います。

### mistvault のソース

`package.json` は指定の GitHub 依存を宣言し、ロックファイルは取得するリビジョンを固定しています。その公開リビジョンにはスコープ Vault がまだないため、Vite と TypeScript は提供されたローカル参照のランタイムを同梱した `vendor/mistvault` に解決します。ライセンスは同ディレクトリにあります。

## English

GDM World is a static, browser-only catalog for games, tools, and creative work. Approved Ed25519 DIDs can publish signed records. One shared distributed vault on mistl escrow holds the full signed catalog history. Run `npm install` and `npm run dev` with Node.js 24, then open `/worlds/`. Set `VITE_ROOT_ADMIN_DIDS` to bootstrap trusted administrators. Copy the mistl room from **Settings → Advanced → Distributed vault** and register it with `mistl escrow rooms add <room>`.

Authors and admins can see 7- and 30-day engagement in the project dialog. Signed `gdmw:stats` records count each viewer DID once per project, metric, and UTC day, excluding the author. Stats are kept locally and synced in the public P2P room for 90 UTC days. New DIDs can inflate counts.

## License

[MPL-2.0](LICENSE). `vendor/mistvault` is also MPL-2.0 (see its own LICENSE).
