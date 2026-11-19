# チケット作成と Markdown 編集

- Dashboard ビュータイトルの `+`（`redmine-client.createTicketFromDashboard`）では `mode: ticket-create` の YAML フロントマターを持つ `redmine-client-new-ticket-{draftId}.md` を開いて件名を選択状態にし、編集開始と同時に未同期一覧（`#NEW <subject>`）とチケット一覧先頭（`#NEW`）へ表示します。初回同期完了後はファイルを `redmine-client-ticket-{issueId}.md` へリネームします（競合や未了時は抑止）。
- Dashboard の New Ticket、チケット行の子チケット作成、コマンドパレットからも作成を始められます。プロジェクトで有効なトラッカーを選択し、子チケットは親チケットを紐付けます。作成フォームで直接同期するか、Markdown の下書きを作成して編集・同期します。
- Markdown の見出しからチケットを作成するコマンドは、対象の見出しと本文、チケット用の YAML フロントマターを作成入力に反映します。フロントマター挿入コマンドは入力用テンプレートを挿入します。
- 既存チケットは閲覧用のプレビューまたは編集用の Markdown（`redmine-client-ticket-{issueId}.md` 等）として開け、既に開いているプライマリ編集タブは未同期編集を上書きせず再利用します。編集用文書では件名・説明・メタデータ（`done_ratio` を含む）を編集でき、`300ms` デバウンス後に編集内容は一覧（進捗バー・ステータス等）・未同期表示・詳細ドロワーへリアルタイムに反映されます。作成後は同じ Markdown ファイルが作成済みチケットの更新文書として機能します。
- チケット編集 Markdown（`redmine-client-*.md`、コメント用ファイルを除く）の YAML フロントマター `issue:` 行には、`mode: ticket-create` を含めトラッカー・ステータス・優先度・進捗率・期日の 5 つの CodeLens を並列表示し、クリックすると QuickPick（期日は候補選択または `YYYY-MM-DD` 入力）で該当フィールドを直接書き換えられます。エディタタイトルメニューには全チケット編集文書で同期アクション（`redmine-client.isTicketEditor`）、既存チケットのチケット編集文書およびコメント編集・追加文書でブラウザで開くアクション（`redmine-client.isExistingTicketEditor`）を配置し、未同期の新規下書きに対する直接実行も警告で抑止します。
- 保存と明示同期は [同期ライフサイクル](offline-sync.md) に従います。リロードではローカル変更や復旧待ちの状態を確認します。編集文書を旧接続先から切り替えるときは [接続先の仕様](connection.md) を参照してください。

## エディタの既定値

Dashboard の設定または対応するコマンドから、件名・説明・トラッカー・優先度・ステータス・期日の既定値を指定・リセットできます。既定値は対応する編集操作の初期入力に使います。候補と入力の検証はプロジェクトのメタデータに従います。

実装は [作成フォーム](../../src/dashboard/services/DashboardComposerService.ts)、[Markdown からの作成](../../src/views/markdownTicketCreateService.ts)、[プレビューと編集](../../src/views/ticketPreview.ts)、[エディタ既定値](../../src/views/ticketEditorDefaultsStore.ts) を参照してください。検証は [機能マップ](../../verification/feature-map.json) の `ticket-editing` と `editor-defaults` を参照してください。
