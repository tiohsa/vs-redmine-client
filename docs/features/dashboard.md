# Dashboard

## 一覧と検索

Activity Bar の Webview に Tickets、Unsynced、Settings があります。Tickets でプロジェクトと子プロジェクトの対象範囲を選びます。チケット行を選択すると Work Panel が開き、ダブルクリックすると Markdown 編集文書が開きます。未同期キューと復旧操作は [保存と同期](offline-sync.md) と [障害復旧](sync-recovery.md) を参照してください。

- プロジェクトの選択肢は名前または識別子で絞り込めます。検索欄の入力だけで現在のプロジェクトは切り替わりません。
- チケット検索は選択プロジェクトの範囲または全プロジェクトを対象にできます。件名・説明の結果を統合し、同じチケットの重複を除きます。数値 ID の直接一致を優先し、`#123` 形式は ID 指定として扱います。検索結果は階層を展開した一覧で表示します。
- クイックフィルターと永続フィルターは読み込み済みのチケットに適用します。表示中、読み込み済み、全件の件数を区別します。追加読み込みと検索のページングは一覧の表示順設定から独立します。

## 並び替えと設定

- 既定順に加えて、優先度・ステータス・トラッカー・担当者・期日・開始日を選べます。項目と昇順・降順は既存の一覧設定に保存し、再読み込み後に復元します。以前に保存された設定も読み込めます。
- 期日（`dueDate`）と開始日（`startDate`）は、選択した項目の有効な暦日（`YYYY-MM-DD`）を比較します。同日は昇順・降順に応じて ID で並べ、未設定・空・不正な日付は両方向とも末尾で ID 昇順に並べます。
- 並び替えは取得済みの絞り込み結果に適用します。通常一覧では同じ階層の兄弟同士を並べ、親子関係を維持します。検索では直接一致の優先を維持します。項目や方向の変更による Redmine への追加リクエストはありません。
- Webview からの入力は [プロトコル](../../src/dashboard/dashboardProtocol.ts) と [検証](../../src/dashboard/dashboardMessageValidation.ts) を通してから処理します。許可外の並び替え項目や方向を持つ `settings.update` は設定を変更しません。
- **Reset Dashboard Cache** は Redmine から再構築可能なデータとメタデータを取り直します。下書き・同期状態・認証情報・設定は保持します。**Reset View State** はレイアウトとクイックフィルターを初期化し、永続のチケット一覧設定を保持します。

実装は [プロジェクトの取得と選択](../../src/dashboard/services/DashboardProjectService.ts)、[チケット取得と検索](../../src/dashboard/services/DashboardTicketService.ts)、[一覧の表示ルール](../../src/views/projectListSettings.ts)、[一覧設定ストア](../../src/views/ticketListSettingsStore.ts) を参照してください。検証は [機能マップ](../../verification/feature-map.json) の `ticket-browsing` と [メンテナンステスト](../../src/test/dashboardMaintenance.test.ts) を参照してください。
