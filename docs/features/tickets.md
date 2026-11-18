# チケット作成と Markdown 編集

- Dashboard の New Ticket、チケット行の子チケット作成、コマンドパレットから作成を始められます。プロジェクトで有効なトラッカーを選択し、子チケットは親チケットを紐付けます。作成フォームで直接同期するか、Markdown の下書きを作成して編集・同期します。
- Markdown の見出しからチケットを作成するコマンドは、対象の見出しと本文、チケット用の YAML フロントマターを作成入力に反映します。フロントマター挿入コマンドは入力用テンプレートを挿入します。
- 既存チケットは閲覧用のプレビューまたは編集用の Markdown として開けます。編集用文書では件名・説明・メタデータを編集できます。作成後は同じ Markdown ファイルが作成済みチケットの更新文書として機能します。
- 保存と明示同期は [同期ライフサイクル](offline-sync.md) に従います。リロードではローカル変更や復旧待ちの状態を確認します。編集文書を旧接続先から切り替えるときは [接続先の仕様](connection.md) を参照してください。

## エディタの既定値

Dashboard の設定または対応するコマンドから、件名・説明・トラッカー・優先度・ステータス・期日の既定値を指定・リセットできます。既定値は対応する編集操作の初期入力に使います。候補と入力の検証はプロジェクトのメタデータに従います。

実装は [作成フォーム](../../src/dashboard/services/DashboardComposerService.ts)、[Markdown からの作成](../../src/views/markdownTicketCreateService.ts)、[プレビューと編集](../../src/views/ticketPreview.ts)、[エディタ既定値](../../src/views/ticketEditorDefaultsStore.ts) を参照してください。検証は [機能マップ](../../verification/feature-map.json) の `ticket-editing` と `editor-defaults` を参照してください。
