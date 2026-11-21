# チケット作成と Markdown 編集

- Dashboard ビュータイトルの `+`（`redmine-client.createTicketFromDashboard`）では `mode: ticket-create` の YAML フロントマターを持つ `redmine-client-new-ticket-{draftId}.md` を開いて件名を選択状態にし、編集開始と同時に未同期一覧（`#NEW <subject>`）とチケット一覧先頭（`#NEW`）へ表示します。初回同期完了後はファイルを `redmine-client-ticket-{issueId}.md` へリネームします（競合や未了時は抑止）。
- Dashboard の New Ticket、チケット行の子チケット作成、コマンドパレットからも作成を始められます。プロジェクトで有効なトラッカーを選択し、子チケットは親チケットを紐付けます。作成フォームで直接同期するか、Markdown の下書きを作成して編集・同期します。
- Markdown の見出しからチケットを作成するコマンドは、対象の見出しと本文、チケット用の YAML フロントマターを作成入力に反映します。フロントマター挿入コマンドは入力用テンプレートを挿入します。
- 既存チケットは閲覧用のプレビューまたは編集用の Markdown（`redmine-client-ticket-{issueId}.md` 等）として開け、既に開いているプライマリ編集タブは未同期編集を上書きせず再利用します。編集用文書では件名・説明・メタデータ（`done_ratio` を含む）を編集できます。件名やステータスなどの表示属性と編集中の状態は、`300ms` デバウンス後に Dashboard の一覧・未同期表示・詳細ドロワーに反映されます。表示項目は [Dashboard](dashboard.md) を参照してください。作成後は同じ Markdown ファイルが作成済みチケットの更新文書として機能します。
- どの作成経路（Dashboard `+`・Composer・Unsynced 単体/一括同期・エディタ保存/同期・`redmine-client.createTicket`・`redmine-client.createTicketFromMarkdownHeader`）であっても、新規チケットの作成同期が完了すると（一括同期時も適格な新規下書きファイルをリネームした上で）、チケット一覧を再取得して作成したチケットを一覧に含め（`ticketListLimit` 超過時やプロジェクト未選択「すべてのプロジェクト」時を含む）、対象プロジェクト・表示フィルター条件に該当する場合は一覧で選択状態にします。
- チケット編集 Markdown（`redmine-client-*.md`、コメント用ファイルを除く）の YAML フロントマター `issue:` 行には、`mode: ticket-create` を含めトラッカー・ステータス・優先度・進捗率・開始日・期日の 6 つの CodeLens を並列表示し、クリックすると QuickPick（開始日・期日は候補選択または `YYYY-MM-DD` 入力）で該当フィールドを直接書き換えられます。エディタタイトルメニューには全チケット編集文書で同期アクション（`redmine-client.isTicketEditor`）、既存チケットのチケット編集文書およびコメント編集・追加文書でブラウザで開くアクション（`redmine-client.isExistingTicketEditor`）を配置し、未同期の新規下書きに対する直接実行も警告で抑止します。
- 保存と明示同期は [同期ライフサイクル](offline-sync.md) に従います。リロードではローカル変更や復旧待ちの状態を確認します。編集文書を旧接続先から切り替えるときは [接続先の仕様](connection.md) を参照してください。

## エディタの既定値

Dashboard の設定または対応するコマンドから、件名・説明・トラッカー・優先度・ステータス・期日の既定値を指定・リセットできます。既定値は対応する編集操作の初期入力に使います。候補と入力の検証はプロジェクトのメタデータに従います。

実装は [作成フォーム](../../src/dashboard/services/DashboardComposerService.ts)、[Dashboard から開く下書き](../../src/dashboard/services/DashboardDraftService.ts)、[Markdown からの作成](../../src/views/markdownTicketCreateService.ts)、[プレビューと編集](../../src/views/ticketPreview.ts)、[エディタ既定値](../../src/views/ticketEditorDefaultsStore.ts) を参照してください。検証は [機能マップ](../../verification/feature-map.json) の `ticket-editing` と `editor-defaults` を参照してください。

[編集中の表示更新](../../src/app/editorDocumentPreview.ts) は文書の接続先に紐付く下書きとキューを参照します。[編集状態のテスト](../../src/test/editorEventController.test.ts) で変更の取り消しや同期中の文書書き換えを確認します。

同期時の書き込みと読み戻しの入口は [作成ハンドラー](../../src/app/ticketSync/ticketCreateHandler.ts) と [更新ハンドラー](../../src/app/ticketSync/ticketUpdateHandler.ts) です。読み戻し後の Markdown と下書きへの反映は、[作成のローカル確定](../../src/app/ticketSync/ticketCreateLocalFinalization.ts) と [更新のローカル確定](../../src/app/ticketSync/ticketUpdateLocalFinalization.ts) が扱います。
