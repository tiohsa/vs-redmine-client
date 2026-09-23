# 中止後のチケット編集継続と状態表示

対象: `improve-bashboard@cf10d96` のレビュー F1・F2。

## 編集文書の許可と同期操作の分離

- `TicketEditAuthorization` は `ticketId`・`documentUri`・`editSessionId` を保持する。接続先ごとのキュー保存領域に、同期操作とは独立した任意フィールドとして永続化する。v3 の操作形式と既存の移行経路は維持する。
- `beginFreshTicketEdit()` は scope transaction 内で現在の操作・中止記録を確認し、保存成功後に許可を公開する。中止した文書そのものには再許可しない。
- 現在の操作がない保存では、文書とセッションの一致を確認して新しい `operationId` を発行する。完了済みの操作IDを渡した登録は拒否する。現在の操作がある場合は、従来の操作ID・文書一致と lifecycle を維持する。
- 編集許可は保存・同期完了・再初期化を越えて保持する。その文書の操作を中止した場合は、操作の移動と許可の取り消しを同じ transaction で保存する。
- 編集許可のない旧 v3 データでは、中止記録と共存する現在の操作の文書から許可を復元し、次の保存時に永続化する。

## 表示

- 通常キューに現在の操作があるか、明示的に開始した編集文書の許可がある場合は、現在の下書きと操作の状態を表示する。
- 中止記録だけが残る場合は、旧下書きの `Conflict` / `Failed` より `Abandoned` を優先する。
- 同期トレイは ViewModel が返す状態を使用する。新しい操作の失敗や競合を隠すフィルターは追加しない。
- 新しい編集開始時には、許可の保存と下書きの更新後にチケット表示を再描画する。

## 回帰検証

- 実際の保存入口と同期サービスを使い、中止 → 新文書 → 保存・同期完了 → 同一文書で再保存・同期完了を検証する。Redmine API と文書書き換えはテスト用実装へ置き換える。
- 操作IDの更新、旧文書・完了済み操作・旧セッションの拒否、接続先分離、再初期化、保存失敗、旧 v3 の復元、中止記録の保持を検証する。
- `Conflict` / `Failed` について、中止後の一覧状態とトレイ、新しい編集と操作の注意表示、再中止時の表示を検証する。

## 実行結果

- `npm run compile-tests`（TypeScript）、`npm run compile`（webpack）、`npm run lint`、`git diff --check`: 成功。
- VS Code 1.138.0 Extension Host の関連8ファイル: 286 passing、0 failing。
  - `offlineSyncStore`、`offlineSyncStoreTransactions`、`ticketSyncService`、`dashboardSyncTray`、`dashboardViewModel`、`dashboardRecoveryPolicy`、`syncAttemptClosurePersistenceFence`、`syncAttemptGenerationM01toM10`。
- 通常の実行は Chromium sandbox の `Operation not permitted` / `SIGTRAP` で起動できず、実行制限の外で同じテストを実行して成功した。
- 再初期化時の既定値補完を踏まえ、中止記録の不変性は復元済みの snapshot と比較する。既存の復旧テストも、中止記録・編集許可・`abandonedItems` を保持する fixture に更新した。
- 実際の Redmine サーバーとの通信および全テストスイートは未実施。
