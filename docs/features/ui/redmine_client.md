# Redmine Client for VS Code 機能・UI詳細仕様書

## 1. アーキテクチャ概要

本拡張機能は、VS Codeの標準APIのみを用いて「高密度なサイドバーダッシュボード」と「Markdownベースの高速チケット編集体験」を両立する。

### 1.1 コンポーネント構成
* **Sidebar (`WebviewViewProvider`)**: チケット一覧・検索・フィルタ・未同期管理を担うWebview。VS Codeテーマ変数（`--vscode-*`）および `@vscode/codicons` を使用し、ネイティブUIと完全に調和させる。
* **Editor (`TextDocument` + `CodeLensProvider`)**: チケットをYAML Frontmatter付きMarkdown（`.md`）として標準テキストエディタで開く。Frontmatter上部に `CodeLens` を表示し、クリック時に `vscode.window.showQuickPick` を呼び出して `WorkspaceEdit` でYAMLを書き換える。
* **Editor Title Menu**: エディタタブ右上に「同期」「ブラウザで開く」コマンドアイコンを配置する。

---

## 2. `package.json` コントリビューション定義

拡張機能マニフェスト（`package.json`）に定義する主要なエントリポイントは以下の通り。

```json
{
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        {
          "id": "redmine-client",
          "title": "Redmine Client",
          "icon": "$(checklist)"
        }
      ]
    },
    "views": {
      "redmine-client": [
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
        "title": "Redmine: 最新情報を取得",
        "icon": "$(refresh)"
      },
      {
        "command": "redmineClient.createTicket",
        "title": "Redmine: 新規チケット作成",
        "icon": "$(add)"
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
      },
      {
        "command": "redmineClient.editFieldViaQuickPick",
        "title": "Redmine: フィールド値を編集"
      }
    ],
    "menus": {
      "editor/title": [
        {
          "command": "redmineClient.syncCurrentTicket",
          "when": "resourceFilename =~ /^redmine-client-ticket-.*\\.md$/",
          "group": "navigation@1"
        },
        {
          "command": "redmineClient.openInBrowser",
          "when": "resourceFilename =~ /^redmine-client-ticket-.*\\.md$/",
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
        "redmineClient.autoSyncOnSave": {
          "type": "boolean",
          "default": false,
          "description": "チケットMarkdownファイルの保存時に自動でRedmineへ同期する"
        }
      }
    }
  }
}
```

---

## 3. サイドバー Webview View 詳細仕様

### 3.1 ヘッダー＆プロジェクト操作領域
| 要素ID / 名称 | UI種別 | 仕様・振る舞い |
| :--- | :--- | :--- |
| **View Header** | ネイティブタイトルバー | タイトル `REDMINE CLIENT: ダッシュボード` と、右端にアクションアイコン（`refresh` / `add` / `list-flat`）を配置する。 |
| **表示密度切替** | アイコンボタン (`codicon-list-flat`) | クリックごとに「標準モード（2行＋進捗バー）」と「コンパクトモード（1行のみ）」をトグルする。状態は `vscode.setState` で保持する。 |
| **プロジェクト選択** | `<select>` ドロップダウン | 選択肢は「すべてのプロジェクト」＋APIから取得したプロジェクト一覧。変更時に即時リストを再フィルタリングする。 |
| **子プロジェクト含める** | トグルアイコン (`codicon-list-tree`) | ON時は `vscode-btn-primary` スタイル、OFF時は `vscode-btn-secondary` スタイルを適用。ツールチップに現在のON/OFF状態を明示する。 |

### 3.2 ナビゲーションタブ
* **チケット (`tickets`)**: フィルタ条件に合致する全チケットを表示。右横にプロジェクト内の総チケット数バッジを表示する。
* **未同期 (`unsynced`)**: ローカルに未同期の変更があるチケットのみを表示。右横に未同期件数バッジを表示し、`0件` の場合はバッジを非表示（`display: none`）とする。
* **設定 (`settings`)**: 主要設定（`serverUrl`, `autoSyncOnSave`）の簡易UIおよび `settings.json` を開くボタンを配置する。

### 3.3 検索＆クイックフィルタ
* **検索インプット**: 入力イベント（`oninput`）で即時フィルタリングを実行。対象フィールドは `#チケット番号`、`件名`、`担当者名`、`トラッカー名`（大文字小文字を区別しない部分一致）。入力文字列が存在する場合のみ右端にクリアボタン（`codicon-close`）を表示する。
* **クイックフィルタチップ（複数選択・AND条件）**:
  * `自分のチケット`: `isMine === true`
  * `未完了`（初期状態ON）: `status !== 'Resolved' && status !== 'Closed'`
  * `期限超過`: `isOverdue === true`（期日が現在日付より前かつ未完了）
  * `高優先度`: `priority === 'High' || priority === 'Urgent'`
* **ゼロ件表示**: 条件一致が0件の場合、「一致するチケットが見つかりません」のメッセージと「フィルタをクリア」リンクを表示する。

### 3.4 チケットリストアイテム構造
各チケット行は以下の要素で構成される（高さ目安：標準モード約 `54px`、コンパクトモード約 `30px`）。

1. **トラッカー識別バー（左端 `3px`）**:
   * `Bug`: `var(--vscode-editorError-foreground)`
   * `Feature`: `var(--vscode-gitDecoration-addedResourceForeground)`
   * `Task` / その他: `var(--vscode-textLink-foreground)`
2. **1行目（メイン情報）**:
   * 折りたたみボタン: 子チケットを持つ親チケットのみ `codicon-chevron-down` / `codicon-chevron-right` を表示。
   * チケット番号: `#123`（等幅フォント `11px`、不透明度 `0.7`）。
   * 優先度インジケータ: `Urgent` の場合は赤字で `!!`、`High` の場合は警告色で `!` を表示。
   * 件名: 1行省略（`text-overflow: ellipsis`）。
   * ホバーアクション: 行ホバー時のみ右端にオーバーレイ表示。未同期時は「同期（`codicon-sync`）」、常に「ブラウザで開く（`codicon-link-external`）」を表示。
3. **2行目（メタ情報 ※標準モードのみ）**:
   * 左側: ステータスバッジ（枠線付きピル）＋ 未同期バッジ（`● 未同期`、`unsynced === true` の場合のみ）。
   * 右側: 担当者（`codicon-account` ＋ 名前）＋ 期日（`codicon-calendar` ＋ `MM/DD`、期限超過時は赤字強調）。
4. **底辺プログレスバー（※標準モードかつ `doneRatio > 0` のみ）**:
   * 高さ `2px` のバー。`100%` の場合は緑系、それ以外は `var(--vscode-progressBar-background)` で描画する。
5. **親子ツリー表現**:
   * 子チケット群を `.tree-children-group` でラップし、左端 `14px` 位置に `var(--vscode-tree-indentGuidesStroke)` の縦ガイド線を描画する。
   * 親チケットがフィルタ条件に不一致でも、子チケットが一致した場合は親チケットを自動展開状態で表示する。

### 3.5 キーボード操作仕様
リスト領域（`#webview-root`）にフォーカスがある場合、以下のキー操作を受け付ける（`<input>`, `<select>` フォーカス時を除く）。
* `ArrowDown` / `ArrowUp`: 表示中のチケット行を上下に移動し、選択チケットをエディタで開く。
* `ArrowRight` / `ArrowLeft`: 子チケットを持つ行の場合、ツリーの展開・折りたたみを切り替える。

---

## 4. メッセージプロトコル仕様（Webview ⇔ Extension Host）

WebviewとExtension Host間は `vscode.postMessage` / `webview.onDidReceiveMessage` を用いてJSONメッセージで通信する。

### 4.1 Webview → Extension Host
| `command` | ペイロード (`payload`) | 処理内容 |
| :--- | :--- | :--- |
| `ready` | なし | Webview初期化完了通知。初期チケット一覧の送信を要求する。 |
| `openTicket` | `{ issueId: number }` | 該当チケットのローカルMarkdownファイルを生成・更新し、`vscode.window.showTextDocument` で開く。 |
| `syncTicket` | `{ issueId: number }` | 指定チケットのローカル変更をRedmine REST API（`PUT /issues/:id.json`）へ送信する。 |
| `refresh` | なし | Redmine APIから最新チケット一覧を再取得し、全ビューを更新する。 |
| `createTicket` | なし | 新規作成用のMarkdownテンプレートファイルを生成してエディタで開く。 |
| `openExternal` | `{ issueId: number }` | `vscode.env.openExternal` で該当チケットのRedmine URLをブラウザで開く。 |
| `openSettingsJson` | なし | `workbench.action.openSettingsJson` コマンドを実行する。 |

### 4.2 Extension Host → Webview
| `command` | ペイロード (`payload`) | 処理内容 |
| :--- | :--- | :--- |
| `setTickets` | `{ tickets: TicketNode[], projects: Project[] }` | チケットツリーとプロジェクト一覧をWebviewへ渡し、再描画する。 |
| `ticketUpdated` | `{ ticket: TicketNode }` | エディタ側でのMarkdown編集・CodeLens変更を即時Webviewリストへ反映する。 |
| `ticketSynced` | `{ issueId: number }` | 同期完了後、該当チケットの `unsynced` フラグを解除して再描画する。 |

---

## 5. エディタ＆CodeLens 詳細仕様

### 5.1 チケットMarkdownフォーマット
ワークスペースの一時ディレクトリまたは管理ディレクトリ内に `redmine-client-ticket-{issueId}.md` として保存する。

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

レシピ更新時にバリデーションエラー281が発生する問題の修正。
```

### 5.2 `CodeLensProvider` 仕様
* **対象ドキュメント**: ファイル名が `redmine-client-ticket-*.md` に一致する `TextDocument`。
* **表示位置**: YAML Frontmatter内の `issue:` 行の直上（該当行の `Range`）。
* **表示項目（5つのCodeLensを同一行に並列表示）**:
  1. `トラッカー: {tracker}` → 引数 `['tracker']` でコマンド実行
  2. `ステータス: {status}` → 引数 `['status']` でコマンド実行
  3. `優先度: {priority}` → 引数 `['priority']` でコマンド実行
  4. `進捗率: {done_ratio}%` → 引数 `['doneRatio']` でコマンド実行
  5. `期日: {due_date || '未設定'}` → 引数 `['dueDate']` でコマンド実行

### 5.3 `QuickPick` によるフィールド更新フロー
1. ユーザーがCodeLensをクリックすると `redmineClient.editFieldViaQuickPick` コマンドが起動する。
2. 対象フィールドに応じた選択肢リストを `vscode.window.showQuickPick` で表示する（期日の場合はカレンダー候補または `showInputBox` による `YYYY-MM-DD` 入力を提供）。
3. 選択確定後、`vscode.WorkspaceEdit` を用いてアクティブドキュメントのYAML Frontmatter該当行のみを置換する。
4. `vscode.workspace.onDidChangeTextDocument` イベントが発火し、ローカルの未同期状態フラグを `true` に更新するとともに、サイドバーWebviewへ `ticketUpdated` メッセージを送信してUIを同期させる。

---

## 6. セキュリティ・非機能要件

* **Content Security Policy (CSP)**: WebviewのHTMLには厳格なCSPを設定し、インラインスクリプトは `nonce` 属性付きのみ許可する。スタイルおよびCodiconフォントは `webview.asWebviewUri` でローカル拡張機能リソースから読み込む。
* **競合防止（楽観的ロック）**: 同期実行時、ローカルの `last_synced_at` とRedmineサーバー上の `updated_on` を比較し、サーバー側が新しい場合は上書き確認ダイアログ（`vscode.window.showWarningMessage`）を表示する。
* **パフォーマンス**: チケット件数が100件を超える場合でもスムーズに動作するよう、検索入力のフィルタ処理には `150ms` のデバウンスを適用する。