# コメントの閲覧・追加・編集

- Dashboard の詳細ドロワーは選択中のチケットに紐付くコメントをタイムライン形式（投稿者名・日時・注記番号）で表示します。コメント欄の「＋」ボタンや各コメント行のクリックから、それぞれ新規コメント追加用（`mode: comment-create`）・既存コメント編集用（`mode: comment-update`）の Markdown エディタを右側エディタに開きます。ローカルの追加・更新ドラフトは未同期として扱います。コメントエディタで既存コメントを編集中の場合、コメント一覧の該当コメント行に `Editing` バッジを表示します。各コメント行をホバーまたはフォーカスすると右上に「同期」（個別コメント同期）と「Redmine で開く」（リモートコメントのみ）のオーバーレイアクションを表示し、新規コメントの同期完了後やコメントエディタ選択時（`followActiveEditor` 有効時）は該当コメントを選択状態にします。
- コマンドパレットの **Redmine: コメントを追加**（`redmine-client.addCommentFromComments`）からも、選択中のチケットの新規コメント追加用エディターを開けます。
- 新規コメント追加用 Markdown は `mode: comment-create` と `issue_id` の YAML フロントマターに続く空の本文欄から書き始めます。保存・同期時は、先頭の Markdown 見出しを含めて本文を Redmine に送信します。互換性のため、本文の最初の空白でない行が対象チケットの旧自動生成見出し（例 `# Comment on ticket #101`）と完全に一致する場合、その行は除外します。既存コメントの編集は現在の Redmine ユーザーに編集権限がある場合に限ります。コメントエディタ上でも `editor/title` の「ブラウザで開く」アクションを利用できます。送信はコメントを紐付けたチケットと接続先で実行します。
- **Redmine: ブラウザで開く** は、既存コメントの編集中、または Redmine エディターがアクティブでなく Dashboard でコメントが選択されている場合に、Redmine の注記番号でコメントの位置を開きます。注記番号は同じチケットの Dashboard から取得し、必要なら現在の接続先に照会します。位置を特定できない場合は通知して終了します。新規コメント下書きでは親チケットを開きます。
- 下書きと更新文書は再オープンできます。リロード時はローカル変更の有無と編集中コメントの状態を確認します。
- コメントも [保存と同期](offline-sync.md) の対象です。追加と更新を別の操作として扱い、作成済みコメントの特定やローカル反映に失敗した場合は復旧情報を保持します。画像付きコメントは [添付処理](attachments.md) を参照してください。
- コメント更新をローカルで確定するときは、通常のエディタの編集基準を同期済みの内容へ更新します。ファイルへの書き戻しは専用のコメント編集文書で行います。

実装は [コメントサービス](../../src/dashboard/services/DashboardCommentService.ts)、[コメント保存](../../src/views/commentSaveSync.ts)、[追加の同期](../../src/app/ticketSync/commentCreateHandler.ts)、[更新の同期](../../src/app/ticketSync/commentUpdateHandler.ts) を参照してください。検証は [コメント表示](../../src/test/commentListMapping.test.ts)、[編集権限](../../src/test/commentPermissions.test.ts)、[追加後の再開](../../src/test/syncCommentCreateResume.test.ts)、[更新時の復旧](../../src/test/commentUpdateRecovery.test.ts) を参照してください。

[ローカルの下書き](../../src/views/commentDraftLocalState.ts) は文書と編集情報を更新します。作成後の [リモート照合](../../src/views/commentRemoteIdentity.ts) では、投稿者と本文が一致する候補が一意のときにコメントを紐付けます。競合時の文書更新は [障害復旧](sync-recovery.md#競合の確認) を参照してください。
