# Dashboard

## 一覧と検索

Activity Bar の Webview に Tickets、Unsynced、Settings があります。Tickets でプロジェクトと子プロジェクトの対象範囲を選びます。チケット行をクリック（選択）すると即座に右側エディタで Markdown 編集文書を開き、同時にサイドバー下部に詳細ドロワー（初期高さ `48%`、狭幅の縦分割時は境界ハンドルで高さ変更可）を展開してコメント履歴を表示します。未同期キューと復旧操作は [保存と同期](offline-sync.md) と [障害復旧](sync-recovery.md) を参照してください。

- プロジェクトの選択肢は名前または識別子で絞り込めます。検索欄の入力だけで現在のプロジェクトは切り替わりません。子プロジェクトを含めるトグル（`codicon-list-tree`）はツールチップに ON/OFF 状態を表示します。
- ビュータイトル（`view/title`）のアクション（更新 `redmine-client.refreshTickets`、新規作成 `redmine-client.createTicketFromDashboard`、表示密度切替 `redmine-client.toggleCompactMode`）で一覧操作を行います。Webview ヘッダー内の重複する更新・新規作成・表示密度ボタンは持たず、プロジェクト選択と子プロジェクト階層トグルのみを配置します。表示密度切替（標準モード：2行 / コンパクトモード：1行のみ）の状態は Webview 状態として保持します。
- チケット検索は選択プロジェクトの範囲または全プロジェクトを対象にできます（入力デバウンス `150ms`）。件名・説明の結果を統合し、同じチケットの重複を除きます。数値 ID の直接一致を優先し、`#123` 形式は ID 指定として扱います。検索結果は階層を展開した一覧で表示します。
- コマンドパレットの **Redmine: チケットを検索**（`redmine-client.searchTickets`）は Dashboard を開き、Tickets タブの検索欄にフォーカスを移します。接続未設定や読み込み中でも入力でき、検索語・検索範囲・適用済みフィルターは維持されます。開いているフィルターダイアログは入力内容を適用せずに閉じます。詳細フォーカスで検索欄が隠れている場合は、その設定を解除して保存し、詳細ドロワーを開いたまま一覧を表示します。VS Code のキーボード ショートカットでこのコマンドにキーを割り当てられます。
- クイックフィルターは `Tickets` タブ専用の 5 種（自分のチケット・未完了〔既定 ON〕・期限超過・高優先度・編集中〔既定 OFF〕）とし、永続フィルターとともに読み込み済みのチケットおよび新規下書き（`#NEW`）に AND 条件で適用します。「編集中」クイックフィルターは既存チケットの `Dirty` および新規下書き（`#NEW`）の `Draft` / `Dirty` のみを表示します。また詳細フィルターダイアログ（`#advanced-filter-dialog`）の同期状態フィルターから、対象範囲（すべて / 編集中（`#NEW` 下書きを含む） / 編集中（既存チケットのみ） / すべての未同期）を選択・永続化できます。未同期アイテムは `Unsynced` タブに表示します。`Unsynced` タブではプロジェクト選択やクイックフィルターによる除外を行わず、同じ接続先の未保存編集・ローカル下書き・同期キューを表示します。同期キューに処理対象がある場合はリスト上部に「すべて同期」を表示します。表示中、読み込み済み、全件の件数を区別し、ゼロ件時はフィルターをクリアする操作（`clear-filters-btn`）を表示します。追加読み込みと検索のページングは一覧の表示順設定から独立します。
- チケット行には優先度インジケータ、枠線付きステータスバッジ、担当者、期日（`MM/DD`・超過強調。完了ステータスは超過扱いとしない）、親子ツリーガイド線を表示します（左端のトラッカー識別バーは表示しません）。チケット行にマウスホバーまたはキーボードフォーカスしたときのみ、右端にオーバーレイで「同期」（既存チケット・新規下書き `#NEW`）、「Redmine で開く」と「削除」（既存チケットのみ）のアクションボタンを表示し、マウスが外れるかフォーカスが離れると非表示にします。選択中のチケット行（通常・子・未同期・新規下書き行およびコンパクトモード共通）と選択中のコメント行（リモート・ローカル下書き共通）は、左バーを用いずに淡いブルー系の背景色（Dark / Light それぞれのテーマ選択色トークンとフォールバック色による `color-mix`）で強調表示し、Webview 非フォーカス時・フォーカス時のいずれでも非選択行・ホバー行と区別でき、WCAG AA 基準（`4.5:1` 以上）のテキストコントラストを維持します（High Contrast / Forced Colors では専用のコントラスト境界とアウトラインを維持します）。行クリックで該当チケットの Markdown 編集文書を開き、`ArrowDown` / `ArrowUp` ではサイドバーのキーボードフォーカスを維持したまま（`preserveFocus: true`）編集文書と詳細ドロワーを切り替え、`ArrowRight` / `ArrowLeft` で子チケットの展開・折りたたみができます。`Escape` キーで詳細ドロワーを閉じます。
- ビュータイトルの更新アクション（`redmine-client.refreshTickets`）は更新中にスピン表示・`aria-busy` 状態となり、完了時に通知します。クイックフィルターで子チケットが一致した場合は折りたたまれた親チケットを自動展開して表示します。
- ビュータイトルの `+` アクション（`redmine-client.createTicketFromDashboard`）は選択中プロジェクトを引き継いで新規チケットの即時ドラフトを開き、同期完了まで一覧先頭に `#NEW` 行（`#tickets-badge` 対象）として表示します。新規チケットの作成同期が完了すると、一覧を再取得して作成したチケットを一覧に含め（`ticketListLimit` 超過時やプロジェクト未選択時も対象）、一覧に表示可能な場合は自動で選択状態にして詳細ドロワー・折りたたみ親の展開・スクロール表示を行います（他タブ表示中に完了した場合は Tickets タブへ戻った時点でスクロール表示します）。Markdown 編集中の変更（既存チケット・新規下書き、`done_ratio` 進捗率や `start_date` 等を含む）も `300ms` デバウンス後に一覧・未同期件数・詳細ドロワーへ即時反映し、同期・リロード完了後もキャッシュへ反映して最新の属性を維持します。
- 詳細ドロワーはサイドバー下半分（初期高さ `48%`、一覧と縦分割）に展開し、一覧背景（`--vscode-sideBar-background`）より自然な濃さの差を持たせた背景（`color-mix`・上端境界線・上向きシャドウ）を持ちます。自動レイアウトかつ幅 `700px` 未満で詳細ドロワーが開いている間は、一覧と詳細ドロワーの境界に水平リサイズハンドル（`#detail-resize-handle`、`role="separator"`、`aria-orientation="horizontal"`）を表示し、左ボタンドラッグで高さをリアルタイム調整、ダブルクリックまたは `Enter` で初期高さ（`48%`）へリセット、`ArrowUp` / `ArrowDown`（5% 刻み）・`Home` / `End` でキーボード調整できます。コメントパネル最小 `120px`・チケット一覧最小 `100px` でクランプ（コンテナ高さ不足時は比率フォールバック）し、ウィンドウサイズ変更時にも再クランプします。調整した高さは Webview 状態（`detailHeightPercent`）へ保存し、不正値時は `48%` へフォールバックします（詳細非表示・幅 `700px` 以上・`layout-split` / `layout-single` / `layout-detail-focus` ではハンドルを非表示にします）。1行の固定コンパクトヘッダー（左側: `#id`・コメントアイコン・見出し・件数バッジ `#detail-comment-count`、右側: プライマリボタン `#add-comment-btn`（`＋` アイコン）・再読み込みボタン `#reload-comments-btn`・閉じるボタン `#detail-cancel-btn`）を配置し（タイトル・プロジェクト名は一覧側と重複するため表示しません）、チケット選択と同時に `#comments-list` へ外枠余白なしの全幅・上下区切り線リスト形式でコメント履歴を表示します。各コメント行（`.comment-card`）は固定高さ（`80px`）とし、ヘッダーを固定したまま本文領域（`.comment-body`）を縦スクロール可能にします。各コメント行をクリックして編集用 Markdown を開けます。また、各コメント行にマウスホバーまたはフォーカスしたときは右上にオーバーレイで「同期」（コメント1件ごとの個別同期）、「Redmine で開く」と「削除」（リモートコメントのみ）を表示します。新規コメントの作成同期が完了したときやコメントエディタを選択したときは、該当コメントを選択状態（`.selected` / `aria-current="true"`、左バーなしの淡いブルー背景ハイライト）にして表示領域へスクロールします。
- 設定タブから `settings.json` を直接開けます。
- チケット行の同期バッジは、編集中の変更を `Editing`、保存済みキューの待機を `Waiting to sync` と表示し、結果不明や復旧待ちなどは該当する同期状態を表示します。コメント行の同期バッジは、コメントエディタで編集中（`isEditing`）のコメントを `Editing`、未同期のコメント編集（`hasUnsyncedEdit`）を `Unsynced edit` と表示します。

## 並び替えと設定

一覧の追加読み込み、関連チケットの切替、フィルター、並び替え、期日表示と一覧設定のリセットは Dashboard 上で操作します。

- 既定順に加えて、優先度・ステータス・トラッカー・担当者・期日・開始日を選べます。項目と昇順・降順は既存の一覧設定に保存し、再読み込み後に復元します。以前に保存された設定も読み込めます。
- 期日（`dueDate`）と開始日（`startDate`）は、選択した項目の有効な暦日（`YYYY-MM-DD`）を比較します。同日は昇順・降順に応じて ID で並べ、未設定・空・不正な日付は両方向とも末尾で ID 昇順に並べます。
- 並び替えは取得済みの絞り込み結果に適用します。通常一覧では同じ階層の兄弟同士を並べ、親子関係を維持します。検索では直接一致の優先を維持します。項目や方向の変更による Redmine への追加リクエストはありません。
- Webview からの入力は [プロトコル](../../src/dashboard/dashboardProtocol.ts) と [検証](../../src/dashboard/dashboardMessageValidation.ts) を通してから処理します。許可外の並び替え項目や方向を持つ `settings.update` は設定を変更しません。
- `redmine-client.ticketList.followActiveEditor`（既定値 `false`）を有効にすると、現在の一覧に表示可能な同一 `connectionScope` の既存チケットと、そのコメントの Markdown エディターに選択が追従します。エディターにフォーカスを残したまま、折りたたまれた親を展開して選択行へスクロールします。別のチケットに選択が移ると詳細ドロワーのコメントを読み込み、コメントの文書であれば該当コメントも選択します。同じチケットのコメント間では一覧内の選択だけを更新します。設定タブのチェックボックスと VS Code 設定は双方向に同期します。
- **Reset Dashboard Cache** は Redmine から再構築可能なデータとメタデータを取り直します。下書き・同期状態・認証情報・設定は保持します。**Reset View State** はレイアウト・コメントパネル高さ（初期値 `48%` へ復元し保存済み `detailHeightPercent` を削除）・クイックフィルターを初期化し、永続のチケット一覧設定を保持します。
- 接続先を変更した場合は切り替え前の取得結果を破棄します。キャッシュ再取得と属性候補の読み込みは [Dashboard のデータ取得](../../src/dashboard/services/DashboardDataService.ts) が扱います。検証は [再取得中の接続切り替え](../../src/test/dashboardCacheInterruption.test.ts) を参照してください。

実装は [プロジェクトの取得と選択](../../src/dashboard/services/DashboardProjectService.ts)、[チケット取得と検索](../../src/dashboard/services/DashboardTicketService.ts)、[一覧の表示ルール](../../src/views/projectListSettings.ts)、[一覧設定ストア](../../src/views/ticketListSettingsStore.ts) を参照してください。検証は [機能マップ](../../verification/feature-map.json) の `ticket-browsing` と [メンテナンステスト](../../src/test/dashboardMaintenance.test.ts) を参照してください。

作成後に表示する項目とエディター追従の対象は [Dashboard の選択処理](../../src/dashboard/services/DashboardSelectionService.ts) が決めます。[作成したチケット](../../src/test/createdTicketListSelection.test.ts)、[作成したコメント](../../src/test/createdCommentListSelection.test.ts)、[エディター追従](../../src/test/editorTicketFollow.test.ts) で確認します。

[Webview スクリプト](../../src/dashboard/dashboardWebviewScript.ts) と [スタイル](../../src/dashboard/dashboardStyles.ts) は、画面別・共通処理の断片を決められた順序で連結します。再描画後のフォーカス、キーボード操作、テーマと表示幅ごとの挙動は [Dashboard UI 検証](../../scripts/check-dashboard-ui.cjs) で確認できます。

Unsynced の [同期操作](../../src/dashboard/services/DashboardUnsyncedService.ts) は [競合の仲介](../../src/dashboard/services/DashboardSyncConflictService.ts)、[結果通知](../../src/dashboard/services/DashboardSyncNotifications.ts)、[破棄・中止などのキュー操作](../../src/dashboard/services/DashboardUnsyncedQueueActions.ts) に処理を渡します。
