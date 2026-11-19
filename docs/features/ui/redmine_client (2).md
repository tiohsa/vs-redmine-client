# Redmine Client VS Code拡張機能 詳細仕様書

## 1. 概要・アーキテクチャ設計

本拡張機能は、VS Codeのサイドバー領域に **Webview View** としてRedmineダッシュボードを提供し、チケットの閲覧・検索・作成・Markdownベースの編集（チケット本体およびコメント追加）および双方向同期を実現する。

### 1.1 システム構成（VS Code API 準拠）

* **サイドバーUI（Webview View）**: `vscode.WebviewViewProvider` を実装。スタイリングにはすべて VS Code 組み込みの CSS カスタムプロパティ（`--vscode-*`）を使用し、Dark / Light / High Contrast 等のあらゆるテーマに自動追従させる。
* **アイコンセット**: `@vscode/codicons` を使用し、VS Code ネイティブUIと視覚的統一性を保つ。
* **チケット・コメント編集エディタ（標準Markdownエディタ）**:
  * チケット選択時は即座にワークスペース内の一時ディレクトリ（例: `.redmine/redmine-client-ticket-{id}.md`）にYAML Frontmatter付きMarkdownを生成し、VS Code標準の `vscode.window.showTextDocument` で右側エディタに開く。
  * コメントの追加・編集も同様に右側Markdownエディタを開いて記述・同期する。
* **エディタ補助UI（100% VS Code標準API構成）**:
  * **Editor Title Menu (`editor/title`)**: タブ右上に「Redmineへ同期」「ブラウザで開く」アイコンを配置。
  * **CodeLens (`vscode.CodeLensProvider`)**: Markdown内の `issue:` 行直上に、トラッカー・ステータス・優先度・進捗率・期日のインラインアクションを表示。
  * **QuickPick (`vscode.window.showQuickPick`)**: CodeLensクリック時に画面上部から標準ドロップダウンを展開し、選択結果を `vscode.WorkspaceEdit` でYAMLへ即座に反映。

---

## 2. 拡張機能マニフェスト定義（`package.json`）

```json
{
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        {
          "id": "redmine-client-container",
          "title": "Redmine Client",
          "icon": "media/redmine-icon.svg"
        }
      ]
    },
    "views": {
      "redmine-client-container": [
        {
          "type": "webview",
          "id": "redmineClient.dashboardView",
          "name": "ダッシュボード"
        }
      ]
    },
    "commands": [
      {
        "command": "redmineClient.refresh",
        "title": "Redmine: チケット一覧を更新",
        "icon": "$(refresh)"
      },
      {
        "command": "redmineClient.createTicket",
        "title": "Redmine: 新規チケット作成",
        "icon": "$(add)"
      },
      {
        "command": "redmineClient.toggleCompactMode",
        "title": "Redmine: 表示密度を切替",
        "icon": "$(list-flat)"
      },
      {
        "command": "redmineClient.syncCurrentTicket",
        "title": "Redmine: 現在のチケットを同期",
        "icon": "$(sync)"
      },
      {
        "command": "redmineClient.openInBrowser",
        "title": "Redmine: ブラウザで開く",
        "icon": "$(link-external)"
      }
    ],
    "menus": {
      "view/title": [
        {
          "command": "redmineClient.refresh",
          "when": "view == redmineClient.dashboardView",
          "group": "navigation@1"
        },
        {
          "command": "redmineClient.createTicket",
          "when": "view == redmineClient.dashboardView",
          "group": "navigation@2"
        },
        {
          "command": "redmineClient.toggleCompactMode",
          "when": "view == redmineClient.dashboardView",
          "group": "navigation@3"
        }
      ],
      "editor/title": [
        {
          "command": "redmineClient.syncCurrentTicket",
          "when": "resourceFilename =~ /^redmine-client-.*\\.md$/",
          "group": "navigation@1"
        },
        {
          "command": "redmineClient.openInBrowser",
          "when": "resourceFilename =~ /^redmine-client-.*\\.md$/",
          "group": "navigation@2"
        }
      ]
    },
    "configuration": {
      "title": "Redmine Client",
      "properties": {
        "redmineClient.serverUrl": {
          "type": "string",
          "default": "",
          "description": "RedmineサーバーのベースURL"
        },
        "redmineClient.apiKey": {
          "type": "string",
          "default": "",
          "description": "Redmine REST APIキー（SecretStorage移行推奨）"
        },
        "redmineClient.autoSyncOnSave": {
          "type": "boolean",
          "default": false,
          "description": "Markdown保存時に自動でRedmineへ同期する"
        }
      }
    }
  }
}
```

---

## 3. UIコンポーネント詳細仕様（Webview View）

### 3.1 プロジェクト選択 & 階層トグルバー
* **レイアウト**: `display: flex; gap: 6px; padding: 0 10px 8px;`
* **プロジェクトドロップダウン**: `<select>` 要素（`--vscode-input-background`）。選択変更時にWebview内キャッシュを再フィルタリングする。
* **子プロジェクト階層トグルボタン**:
  * アイコン: `codicon-list-tree`
  * ON状態: `--vscode-button-background` / OFF状態: `--vscode-button-secondaryBackground`
  * 役割: 選択プロジェクト配下のサブプロジェクトチケットを含めるかを切り替える。

### 3.2 ナビゲーションタブ（役割分離）
* **構成**: `チケット [総数]` / `未同期 [未同期数]` / `設定`
* **`未同期` タブの専用化（二重絞り込み防止）**:
  * `未同期` タブ選択時は、クイックフィルタ（`未完了` 等）やプロジェクト選択による除外を行わず、**すべての未同期変更（ローカル下書き）を漏れなく表示**する。
  * 未同期が `1件以上` ある場合、リスト上部に「すべて同期」バーを表示し一括送信を可能にする。
  * 未同期チケットが `0件` の場合はバッジを非表示（`display: none`）とする。

### 3.3 検索 & クイックフィルタバー
* **検索ボックス**:
  * 対象フィールド: `チケット番号 (#id)`、`件名 (subject)`、`担当者名 (assignee)`、`トラッカー名 (tracker)` の部分一致（大文字・小文字区別なし）。
  * クリアボタン（`codicon-close`）は入力文字列が1文字以上のときのみ右端に表示。
* **クイックフィルタチップ（`チケット` タブ表示時のみ有効・AND条件）**:
  * `自分のチケット`: `assignee_id === currentUser.id`
  * `未完了`: `status.is_closed === false`（デフォルトON）
  * `期限超過`: `due_date < today && !status.is_closed`
  * `高優先度`: `priority` が `High` または `Urgent` 相当

### 3.4 チケットリストアイテム構造
狭小幅（`260px`〜`420px`）でも情報欠落や折り返し崩れが起きないよう、リスト行はクリーンに保ち、冗長な「編集」ボタンなどは配置しない。

1. **トラッカー識別カラーバー（左端 `3px`）**:
   * `Bug`: `var(--vscode-editorError-foreground)`
   * `Feature`: `var(--vscode-gitDecoration-addedResourceForeground)`
   * `Task` / その他: `var(--vscode-textLink-foreground)`
2. **未同期ハイライト**:
   * 未同期変更を持つ行は背景色に `color-mix(in srgb, var(--vscode-gitDecoration-modifiedResourceForeground) 8%, transparent)` を適用。
3. **1行目（ヘッダー行）**:
   * 折りたたみ矢印（子チケットを持つ親チケットのみ `codicon-chevron-down` / `codicon-chevron-right`）
   * チケット番号（等幅フォント `11px`、不透明度 `0.7`）
   * 優先度インジケータ（`Urgent` は赤色 `!!`、`High` は黄色 `!`、`Normal` 以下は非表示）
   * 件名（`text-overflow: ellipsis; white-space: nowrap;` で1行省略）
4. **2行目（メタ情報行・標準モード時のみ表示）**:
   * 左側: ステータスバッジ（枠線ピル型） ＋ 未同期ラベル（`● 未同期`）
   * 右側: 担当者アイコン＋名前 ＋ 期日（`MM/DD`形式、期限超過時は赤文字強調）
5. **底辺プログレスバー（`done_ratio > 0` かつ標準モード時のみ）**:
   * 高さ `2px` の極細バー。`100%` 時は緑色（`--vscode-gitDecoration-addedResourceForeground`）、それ以外は `--vscode-progressBar-background`。
6. **親子ツリー表現**:
   * 子チケットには `padding-left: 26px` を設定し、疑似要素（`::before` / `::after`）により `--vscode-tree-indentGuidesStroke` 色のL字ガイド線を描画する。
7. **行クリック時の挙動（即エディタ表示 ＋ 詳細ドロワー連動）**:
   * チケット行をシングルクリックすると、該当行を選択状態（`.is-selected`）にし、**即座に右側エディタで該当チケットのMarkdownファイルを開く（`openTicket`）**。同時にサイドバー下部にチケット詳細ドロワー（概要・コメント履歴閲覧）を展開する。

### 3.5 ボタン・クリック要素 インタラクション一覧（全重複＆冗長ボタン排除済）

| 配置場所 | UI要素 | クリック時のアクション | 設計意図 |
| :--- | :--- | :--- | :--- |
| **ビュータイトル** | 更新アイコン (`codicon-refresh`) | `postMessage({ command: 'refresh' })` を送信し、Redmine APIから最新一覧を再取得。 | 通信中は `codicon-modifier-spin` を付与。 |
| **ビュータイトル** | 新規作成アイコン (`codicon-add`) | `postMessage({ command: 'createTicket' })` を送信し、新規チケット用Markdownを生成して右側エディタで開く。 | 詳細は「5.4 新規チケット作成フロー」参照。 |
| **ビュータイトル** | 表示密度アイコン (`codicon-list-flat`) | Webview内の `compactMode` 状態を切り替え、リストの2行目・進捗バーの表示/非表示を即時反映。 | 1画面あたりの表示件数を増やすときに使用。 |
| **プロジェクト欄** | プロジェクト `<select>` | 選択プロジェクトIDを保存し、`チケット` タブの表示チケットを絞り込む。 | `未同期` タブではプロジェクト横断で未同期を表示。 |
| **プロジェクト欄** | 子プロジェクトトグル (`codicon-list-tree`) | `includeSubprojects` のON/OFFを切り替える。 | ツールチップで現在のON/OFF状態を明示。 |
| **ナビタブ** | `チケット` / `未同期` / `設定` | 各ビューへ切り替える。`未同期` タブはフィルタを無視し全未同期アイテムを列挙。 | タブとフィルタの二重絞り込みによる見落としを防止。 |
| **未同期タブ上部** | `すべて同期` ボタン | 未同期キューにある全チケットを順次Redmineへ同期する。 | 複数チケット編集後の一括反映用。 |
| **検索欄** | クリアボタン (`codicon-close`) | 検索入力欄を空にし、リストの絞り込みを即座に解除する。 | 入力文字があるときのみ表示。 |
| **フィルタ欄** | クイックフィルタピル（4種） | 各フィルタ条件（自分のチケット / 未完了 / 期限超過 / 高優先度）のON/OFFをトグルする。 | `チケット` タブ専用。 |
| **チケット行** | **チケット行本体（クリック）** | 該当行を選択状態にし、**右側エディタでチケットMarkdownを開く**と同時に、下部詳細ドロワーへ概要・コメントを表示する。 | クリック即編集が可能なため「編集」ボタンは不要。 |
| **チケット行** | 折りたたみ矢印 (`chevron-down/right`) | 該当親チケットの `expanded` 状態を反転し、子チケットの表示/非表示を切り替える。 | `event.stopPropagation()` により行クリックは発火しない。 |
| **詳細ドロワー** | `同期` ボタン (`codicon-sync`) | `postMessage({ command: 'syncTicket', issueId })` を送信し、ローカル変更をRedmineへ同期する。 | サイドバー側の個別同期操作をここに集約。 |
| **詳細ドロワー** | 外部リンク (`codicon-link-external`) | `postMessage({ command: 'openExternal', issueId })` を送信し、ブラウザでRedmineを開く。 | チケット詳細確認時のWeb遷移導線。 |
| **詳細ドロワー** | 閉じるボタン (`codicon-close`) | 下部詳細ドロワーを閉じ、チケットリストを全画面高さに戻す。 | `Esc` キーでも閉じる。 |
| **詳細ドロワー** | コメントタブ内 `＋ コメント追加` | `postMessage({ command: 'openCommentEditor', issueId })` を送信し、**右側エディタでコメント追加用Markdownを開く**。 | 長文やコードブロックを含むコメントもエディタで快適に記述可能。 |
| **詳細ドロワー** | コメント行クリック / ホバーアイコン | `postMessage({ command: 'openCommentEditor', issueId, journalId })` を送信し、**右側エディタで該当コメントの編集用Markdownを開く**。 | 既存コメントの修正もエディタに統一。 |
| **設定タブ** | `settings.json を開く` ボタン | `postMessage({ command: 'openSettingsJson' })` を送信し、VS Codeの設定ファイルを開く。 | `workbench.action.openSettingsJson` を実行。 |
| **エディタ右上** | Editor Title：同期 / 外部リンク | アクティブなMarkdownファイルの同期（`syncCurrentTicket`）またはブラウザ表示（`openInBrowser`）。 | エディタ作業中の直接操作用。 |

### 3.6 チケット詳細ドロワー仕様（サイドバー下部スプリットペイン）

チケット行クリック時にサイドバー下半分（初期高さ `48%`）に展開される閲覧・同期ドロワーの仕様。編集操作はすべて右側エディタに集約しているため、ドロワー内はシンプルに保つ。

1. **コンパクトヘッダー（2段構成）**:
   * **1段目**: 左端にトラッカー色バー（`3px`）、`#番号`、件名（1行省略）、右端に「閉じる（`codicon-close`）」ボタン。
   * **2段目**: 左側にプロジェクト名・未同期インジケータ（`● 未同期`）、右側に **`同期` と `ブラウザで開く` の2アクションのみ**を配置する（「編集」ボタンは不要）。
2. **サブタブ切り替え（`概要` / `コメント [件数]`）**:
   * **概要タブ**:
     * ステータス・優先度・担当者・期日を2列のコンパクトなメタグリッドで表示。
     * 未同期変更がある場合、説明欄の上部に1行のスリムな警告バナー（`var(--vscode-editorWarning-foreground)`）を表示。
     * 説明（Redmine上の内容）をスクロール可能な枠内に表示。
   * **コメントタブ**:
     * ヘッダー右端に「＋ コメント追加」ボタンを配置。クリックするとサイドバー内フォームではなく、**右側エディタに新規コメント用Markdown（`mode: comment-create`）を開く**。
     * 各コメントはタイムライン形式で表示し、投稿者名・日時・注記番号（`#635`）を1行ヘッダーに収める。コメントをクリックすると右側エディタで該当コメントの編集用Markdownを開く。

### 3.7 キーボード操作仕様
* リストフォーカス中に `ArrowDown` / `ArrowUp` で選択チケットを上下に移動し、右側エディタと詳細ドロワー表示を連動更新する。
* `Escape` キーで開いているQuickPickまたは詳細ドロワーを閉じる。

---

## 4. Webview ↔ Extension Host 通信プロトコル

### 4.1 Webview → Extension Host (`vscode.postMessage`)

| `command` | ペイロード (`data`) | Extension Host 側の処理内容 |
| :--- | :--- | :--- |
| `ready` | なし | 初期データ（プロジェクト一覧、キャッシュ済みチケット一覧、ユーザー設定）を `initData` で返却する。 |
| `openTicket` | `{ issueId: number }` | 該当チケットのローカルMarkdownファイルを生成・更新し、`vscode.window.showTextDocument` で右側エディタに開く。 |
| `openCommentEditor` | `{ issueId: number, journalId?: number }` | `journalId` が未指定なら新規コメント用Markdown（`mode: comment-create`）、指定ありなら既存コメント編集用Markdown（`mode: comment-update`）を右側エディタに開く。 |
| `syncTicket` | `{ issueId: number }` | ローカルの未同期Markdownをパースし、Redmine REST API (`PUT /issues/{id}.json` または `POST /issues.json`) へ送信する。 |
| `syncAllTickets` | `{ issueIds: number[] }` | 未同期キューにある複数チケットを順次Redmineへ送信し、結果を通知する。 |
| `createTicket` | `{ projectId?: number }` | `mode: ticket-create` の新規テンプレートMarkdownを生成し、右側エディタで開く。 |
| `refresh` | `{ projectId?: number, includeSubprojects: boolean }` | Redmine API から最新のチケット一覧をフェッチし、`ticketsUpdated` メッセージでWebviewへ通知する。 |
| `openExternal` | `{ issueId: number }` | `vscode.env.openExternal(vscode.Uri.parse(`${serverUrl}/issues/${issueId}`))` を実行する。 |
| `openSettingsJson` | なし | `vscode.commands.executeCommand('workbench.action.openSettingsJson', 'redmineClient')` を実行する。 |

### 4.2 Extension Host → Webview (`webview.postMessage`)

| `command` | ペイロード (`data`) | Webview 側の処理内容 |
| :--- | :--- | :--- |
| `initData` | `{ projects, tickets, currentUser, state }` | プロジェクト一覧とチケットツリーを描画し、前回のフィルタ状態を復元する。 |
| `ticketsUpdated` | `{ tickets }` | チケット一覧およびバッジ件数（総数・未同期数）を再描画する。 |
| `ticketMarkedUnsynced` | `{ issueId: number, draftData }` | エディタでの編集内容を即座にリスト上の該当行（ステータス・進捗・未同期バッジ）へ反映する。 |
| `ticketSynced` | `{ issueId: number, updatedTicket }` | 該当チケットの `unsynced` フラグを解除し、最新データで再描画する。 |

---

## 5. エディタ連携仕様（Markdown / CodeLens / QuickPick）

### 5.1 ローカルMarkdownファイル形式

1. **チケット本体編集用**（`redmine-client-ticket-{issue_id}.md`）:
   ```markdown
   ---
   mode: ticket-update
   project_id: 1
   issue_id: 3
   last_synced_at: 2026-11-19T13:58:00.000Z
   issue:
     tracker:    Bug
     priority:   High
     status:     New
     assignee:   自分
     due_date:   2026-11-17
     done_ratio: 30
   ---

   # Error 281 when updating a recipe

   ここにチケットの説明本文をMarkdown形式で記述します。
   ```

2. **コメント追加・編集用**（`redmine-client-comment-{issue_id}-{new|journal_id}.md`）:
   ```markdown
   ---
   mode: comment-create
   issue_id: 3
   ---

   # チケット #3 へのコメント

   ここにコメント本文をMarkdown形式で記述します。
   同期ボタン（または保存時自動同期）でRedmineへ投稿されます。
   ```

### 5.2 CodeLens & QuickPick 実装仕様

1. **CodeLensProvider 登録**:
   * 対象ドキュメント: `{ language: 'markdown', pattern: '**/redmine-client-ticket-*.md' }`（チケット本体ファイル時のみ表示）
   * YAML Frontmatter内の `issue:` 行を正規表現で検出し、その直上の `Range` に対して以下の `vscode.CodeLens` を返す：
     * `トラッカー: {tracker}` → コマンド `redmineClient.pickField` (`args: [uri, 'tracker']`)
     * `ステータス: {status}` → コマンド `redmineClient.pickField` (`args: [uri, 'status']`)
     * `優先度: {priority}` → コマンド `redmineClient.pickField` (`args: [uri, 'priority']`)
     * `進捗率: {done_ratio}%` → コマンド `redmineClient.pickField` (`args: [uri, 'done_ratio']`)
     * `期日: {due_date || '未設定'}` → コマンド `redmineClient.pickField` (`args: [uri, 'due_date']`)
2. **QuickPick による値更新 (`redmineClient.pickField`)**:
   * 対象プロジェクトで利用可能なトラッカー・ステータス・優先度マスタを `vscode.window.showQuickPick` で表示（期日については日付候補のQuickPickまたは `vscode.window.showInputBox` で `YYYY-MM-DD` 入力）。
   * 選択確定後、`vscode.WorkspaceEdit` を用いて該当YAMLキーの行を置換し、同時にWebviewへ `ticketMarkedUnsynced` メッセージを送信してサイドバー表示をリアルタイム更新する。

### 5.3 双方向リアルタイム同期フロー
1. ユーザーがエディタ上でMarkdownを編集（タイピングまたはQuickPick選択）すると、`vscode.workspace.onDidChangeTextDocument`（300msデバウンス）が発火。
2. YAML Frontmatter および `# 見出し`（件名）をパースし、ローカル下書きキャッシュを更新してWebviewへ `ticketMarkedUnsynced` を送信。
3. ユーザーが「同期」ボタン（Editor Title Menu または 詳細ドロワーの同期ボタン）を押下、あるいは `autoSyncOnSave` が有効な状態で `Ctrl+S` を押下すると、Redmine REST API へリクエストを送信し、成功後に `last_synced_at` を更新して未同期状態を解除する。

### 5.4 新規チケット作成フロー（`+` ボタン押下時）
1. ユーザーがビュータイトルの `+`（`redmineClient.createTicket`）をクリック。
2. Extension Host 側で現在選択中のプロジェクトID（未選択時はデフォルトプロジェクト）を取得し、一時ファイル `redmine-client-new-{timestamp}.md` を以下の初期テンプレートで生成する：
   ```markdown
   ---
   mode: ticket-create
   project_id: 1
   issue:
     tracker:    Task
     priority:   Normal
     status:     New
     assignee:   
     due_date:   
     done_ratio: 0
   ---

   # 新規チケットの件名

   ここにチケットの詳細を記述してください。
   ```
3. 生成したファイルを `vscode.window.showTextDocument` で右側エディタに開き、同時にサイドバーの「未同期」リストへ下書きアイテムを追加する。
4. ユーザーが件名・本文・CodeLens項目を編集し「同期」を実行すると、`POST /issues.json` でRedmine上にチケットを起票する。
5. 起票成功後、返却された正式な `issue.id` を用いてファイルを `redmine-client-ticket-{newId}.md` へリネームし、Frontmatterの `mode` を `ticket-update` へ書き換えて通常チケットとして管理を継続する。