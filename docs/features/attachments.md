# Markdown 画像と添付

- ファイルベースの Markdown 文書で、貼り付けた画像などのローカル画像を同期時にアップロードします。相対パスは文書を基準に解決し、Redmine 向けの本文では添付を参照する表記に変換します。まだ保存先のない文書は、先にファイルとして保存します。
- 同期処理は添付の論理ファイル名を解決し、名前の衝突を避けます。ローカルの実体と Redmine に渡す名前はそれぞれ管理します。
- リモート書き込み前に `contentHash`、`contentSize`、`spoolFilePath` を確定します。再試行や VS Code の再起動後も同じ添付の識別情報と凍結済みデータを使います。永続スプールのクリーンアップは現在の操作から参照されるデータを保持します。
- Markdown から直接チケットを作成する `redmine-client.createTicket` は、Mermaid コードブロックを Redmine 送信用の `{{mermaid ... }}` 形式へ変換します。Redmine 側の描画には対応する拡張が必要です。

実装は [画像リンク処理](../../src/utils/markdownImageLinks.ts)、[画像アップロード](../../src/utils/markdownImageUpload.ts)、[永続スプール](../../src/app/ticketSync/uploadSpoolStore.ts)、[クリーンアップ](../../src/app/ticketSync/uploadSpoolCleanup.ts) を参照してください。検証は [ファイル名の衝突](../../src/test/markdownImageFilenameCollisions.test.ts)、[スプール](../../src/test/uploadSpoolStore.test.ts)、[新規チケットの画像](../../src/test/newTicketMarkdownImages.test.ts)、[コメント画像](../../src/test/commentSaveSyncMarkdownImages.test.ts) を参照してください。
