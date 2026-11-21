# コメントの閲覧・追加・編集

- Dashboard の詳細ドロワーは選択中のチケットに紐付くコメントをタイムライン形式（投稿者名・日時・注記番号）で表示します。コメント欄の「＋ コメント追加」ボタンや各コメント行のクリックから、それぞれ新規コメント追加用（`mode: comment-create`）・既存コメント編集用（`mode: comment-update`）の Markdown エディタを右側エディタに開きます。ローカルの追加・更新ドラフトは未同期として扱います。
- 新規コメント追加用 Markdown には `mode: comment-create` と `issue_id` の YAML フロントマターおよび見出しテンプレートを初期挿入し、保存・同期時には本文のみを抽出して Redmine へ送信します。既存コメントの編集は現在の Redmine ユーザーに編集権限がある場合に限ります。コメントエディタ上でも `editor/title` の「ブラウザで開く」アクションを利用できます。送信はコメントを紐付けたチケットと接続先で実行します。
- 下書きと更新文書は再オープンできます。リロード時はローカル変更の有無と編集中コメントの状態を確認します。
- コメントも [保存と同期](offline-sync.md) の対象です。追加と更新を別の操作として扱い、作成済みコメントの特定やローカル反映に失敗した場合は復旧情報を保持します。画像付きコメントは [添付処理](attachments.md) を参照してください。
- コメント更新をローカルで確定するときは、通常のエディタの編集基準を同期済みの内容へ更新します。ファイルへの書き戻しは専用のコメント編集文書で行います。

実装は [コメントサービス](../../src/dashboard/services/DashboardCommentService.ts)、[コメント保存](../../src/views/commentSaveSync.ts)、[追加の同期](../../src/app/ticketSync/commentCreateHandler.ts)、[更新の同期](../../src/app/ticketSync/commentUpdateHandler.ts) を参照してください。検証は [コメント表示](../../src/test/commentListMapping.test.ts)、[編集権限](../../src/test/commentPermissions.test.ts)、[追加後の再開](../../src/test/syncCommentCreateResume.test.ts)、[更新時の復旧](../../src/test/commentUpdateRecovery.test.ts) を参照してください。

[ローカルの下書き](../../src/views/commentDraftLocalState.ts) は文書と編集情報を更新します。作成後の [リモート照合](../../src/views/commentRemoteIdentity.ts) では、投稿者と本文が一致する候補が一意のときにコメントを紐付けます。競合時の文書更新は [障害復旧](sync-recovery.md#競合の確認) を参照してください。
