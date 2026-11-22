# チケット作成と Markdown 編集

- Dashboard ビュータイトルの `+`（`redmine-client.createTicketFromDashboard`）では `mode: ticket-create` の YAML フロントマターを持つ `redmine-client-new-ticket-{draftId}.md` を開いて件名を選択状態にし、編集開始と同時に未同期一覧（`#NEW <subject>`）とチケット一覧先頭（`#NEW`）へ表示します。初回同期完了後はファイルを `redmine-client-ticket-{issueId}.md` へリネームします（競合や未了時は抑止）。
- Dashboard の New Ticket、チケット行の子チケット作成、コマンドパレットからも作成を始められます。プロジェクトで有効なトラッカーを選択し、子チケットは親チケットを紐付けます。作成フォームで直接同期するか、Markdown の下書きを作成して編集・同期します。
- Markdown の見出しからチケットを作成するコマンドは、対象の見出しと本文、チケット用の YAML フロントマターを作成入力に反映します。フロントマター挿入コマンドは入力用テンプレートを挿入します。
- 既存チケットは閲覧用のプレビューまたは編集用の Markdown（`redmine-client-ticket-{issueId}.md` 等）として開け、既に開いているプライマリ編集タブは未同期編集を上書きせず再利用します。編集用文書では件名・説明・メタデータ（`done_ratio` を含む）を編集できます。件名やステータスなどの表示属性と編集中の状態は、`300ms` デバウンス後に Dashboard の一覧・未同期表示・詳細ドロワーに反映されます。表示項目は [Dashboard](dashboard.md) を参照してください。作成後は同じ Markdown ファイルが作成済みチケットの更新文書として機能します。
- どの作成経路（Dashboard `+`・Composer・Unsynced 単体/一括同期・エディタ保存/同期・`redmine-client.createTicket`・`redmine-client.createTicketFromMarkdownHeader`）であっても、新規チケットの作成同期が完了すると（一括同期時も適格な新規下書きファイルをリネームした上で）、チケット一覧を再取得して作成したチケットを一覧に含め（`ticketListLimit` 超過時やプロジェクト未選択「すべてのプロジェクト」時を含む）、対象プロジェクト・表示フィルター条件に該当する場合は一覧で選択状態にします。
- チケット編集 Markdown（`redmine-client-*.md`、コメント用ファイルを除く）の YAML フロントマター `issue:` 行には、`mode: ticket-create` を含めトラッカー・ステータス・優先度・進捗率・開始日・期日の 6 つの CodeLens を並列表示し、クリックすると QuickPick（開始日・期日は候補選択または `YYYY-MM-DD` 入力）で該当フィールドを直接書き換えられます。エディタタイトルメニューには全チケット編集文書で同期アクション（`redmine-client.isTicketEditor`）、既存チケットのチケット編集文書およびコメント編集・追加文書でブラウザで開くアクション（`redmine-client.isExistingTicketEditor`）を配置し、未同期の新規下書きに対する直接実行も警告で抑止します。
- コマンドパレットの **Redmine: ブラウザで開く**（`redmine-client.openInBrowser`）は、アクティブな Redmine エディター、Dashboard の選択の順で対象を判定します。エディター上部のボタンはその文書を、Dashboard の行ボタンはその行を開きます。別接続の文書や未同期の新規チケットを選ぶと通知して終了します。Dashboard では選択チケットに属する選択済みコメントを優先し、なければチケットを開きます。互換用の `redmine-client.openTicketInBrowser` は URI、Dashboard の選択、アクティブエディターの順で解決し、`redmine-client.openCommentInBrowser` は Quick Pick で対象を選びます。旧 ID はパレットに表示せず、既存のキーバインドや `executeCommand` から利用できます。
- 保存と明示同期は [同期ライフサイクル](offline-sync.md) に従います。リロードではローカル変更や復旧待ちの状態を確認します。編集文書を旧接続先から切り替えるときは [接続先の仕様](connection.md) を参照してください。
- 既存チケットの編集を保存すると、Dashboard の一覧・詳細・「編集中」フィルターに保存結果を反映します。手動同期ではキューに保存した変更を「同期待ち」と表示し、リモートと同じ内容に戻して保存したときは「編集中」を解除します。保存処理中に加えた未保存の変更は「編集中」として表示します。
- 保存済みのチケットエディターを閉じたり、別のタブに切り替えたりしても、保存済みの同期状態を維持します。

## エディタの既定値

Dashboard の設定または対応するコマンドから、件名・説明・トラッカー・優先度・ステータス・期日の既定値を指定・リセットできます。既定値は対応する編集操作の初期入力に使います。候補と入力の検証はプロジェクトのメタデータに従います。

## チケットの削除

Dashboard の既存チケット行をホバーまたはキーボードでフォーカスし、「削除」を選びます。確認ダイアログには対象の番号と件名、子チケット・コメント・作業時間の記録などが一緒に削除されることが表示されます。承認後に Redmine で削除し、対象の消失を確認してから一覧と検索結果を更新します。選択中のチケットが削除された場合は選択を解除して詳細ドロワーを閉じます。

削除対象や配下に未保存・未同期の変更、実行中の同期、復旧待ちの同期がある場合は、該当項目を表示し、削除を中止します。子チケットがない場合は対象チケットの変更だけを照合します。

親子関係の照会が HTTP 403 または 404 で拒否された場合は、影響の可能性がある保留項目の種類、変更先または下書き名、照会できなかった参照先を表示します。未保存の変更を含め、保留項目は Unsynced に表示します。削除確認から読み取り専用の内容を開くか、「Unsynced を開く」で該当項目へ移動できます。いずれの操作も削除確認を終了し、保存や同期は実行しません。削除する場合はチケット行の「削除」を押して改めて確認します。すべての保留項目を確認できる場合に限り、親子関係が不明でも、配下なら Redmine 上の反映先が削除されることを理解した上で削除を承認できます。保留項目の内容や影響範囲が変わると、承認を無効にします。

確認前と承認後の送信直前に対象と接続先を照合し、送信前に接続先が変わるか影響範囲が変化した場合は送信しません。送信後に接続先が変わった場合は元の接続先で読み戻しを完了しても、新しい接続先の画面や状態には結果を反映しません。明示的な削除承認後に同じ接続先へ `DELETE /issues/{issueId}.json` を送り、詳細の読み戻しで消失を確認します。キャンセル時は書き込みません。対象範囲の同期と重複する書き込みを防ぎ、下書き・ファイル・キューは保持します。通信断などで結果を確認できない場合はその旨を表示し、読み取りで照合します。削除の自動再送やオフライン予約は行いません。

実装は [作成フォーム](../../src/dashboard/services/DashboardComposerService.ts)、[Dashboard から開く下書き](../../src/dashboard/services/DashboardDraftService.ts)、[Markdown からの作成](../../src/views/markdownTicketCreateService.ts)、[プレビューと編集](../../src/views/ticketPreview.ts)、[エディタ既定値](../../src/views/ticketEditorDefaultsStore.ts) を参照してください。検証は [機能マップ](../../verification/feature-map.json) の `ticket-editing` と `editor-defaults` を参照してください。

[編集中の表示更新](../../src/app/editorDocumentPreview.ts) は文書の接続先に紐付く下書きとキューを参照します。[編集状態のテスト](../../src/test/editorEventController.test.ts) で変更の取り消しや同期中の文書書き換えを確認します。

同期時の書き込みと読み戻しの入口は [作成ハンドラー](../../src/app/ticketSync/ticketCreateHandler.ts) と [更新ハンドラー](../../src/app/ticketSync/ticketUpdateHandler.ts) です。読み戻し後の Markdown と下書きへの反映は、[作成のローカル確定](../../src/app/ticketSync/ticketCreateLocalFinalization.ts) と [更新のローカル確定](../../src/app/ticketSync/ticketUpdateLocalFinalization.ts) が扱います。

削除の進行は [削除サービス](../../src/layers/extension-host/features/delete-redmine-items/deletionService.ts)、影響範囲の判定は [削除評価](../../src/layers/extension-host/features/delete-redmine-items/deletionAssessment.ts)、読み戻しは [削除結果の照合](../../src/layers/extension-host/features/delete-redmine-items/deletionVerification.ts) が扱います。[実 Redmine の Dashboard 検証](../../src/test/live/dashboardWorkflow.test.ts) の `LIVE-B08` はチケット削除と一覧を照合します。
