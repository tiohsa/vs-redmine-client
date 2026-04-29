# 修正仕様書: Dashboard Webview 改善

対象リポジトリ: `tiohsa/vs-redmine-client`  
対象ブランチ: `claude/stabilize-dashboard-webview-o0B0a`  
対象PR: #9 `リファクタリング`

---

## 1. 背景

現在の `claude/stabilize-dashboard-webview-o0B0a` ブランチでは、従来の Projects / Tickets / Comments / Unsynced Files / Ticket Settings の複数 TreeView を、単一の `Dashboard` Webview に統合する方向で実装されている。

この方向性は妥当である。一方で、次の UX・可読性・保守性上の課題が残っている。

1. チケット一覧の ID や補助テキストの色が背景と同化し、視認性が低い。
2. Webview 上に既にある操作・設定と、Settings タブ内の設定項目が重複している。
3. チケット編集ファイルの YAML frontmatter は同期には必要だが、ユーザーが「何のチケットを編集しているか」を把握する UI としては弱い。
4. `tracker` / `priority` / `status` を手入力する設計は、Redmine の選択肢を知らないユーザーにとって分かりにくい。
5. チケット選択後、コメントや詳細確認のためにタブ移動が必要になり、Dashboard としての作業導線が分断されている。

本仕様書では、これまでのレビューと改善案を統合し、実装すべき修正内容を定義する。

---

## 2. 基本方針

### 2.1 UI 方針

Dashboard Webview を、Redmine チケット操作の主 UI とする。

ユーザーが YAML frontmatter を直接読んだり、`tracker` などの値を手入力したりしなくても、主要な操作が Webview 上で完結することを目指す。

### 2.2 Markdown / frontmatter 方針

Markdown ファイルから frontmatter を完全に削除しない。

frontmatter は同期・競合検知・ローカル保存復元のための最小メタデータとして残す。

```text
Webview = 人間が見る・選ぶ・編集する UI
Markdown frontmatter = 同期用の最小メタデータ
Markdown body = 件名・説明本文
```

### 2.3 デザイン方針

`DESIGN.md` に従い、MiniMax 風の白基調・pill UI・丸みのあるカード・ブランドブルー・控えめなシャドウを維持する。

ただし VS Code Activity Bar 内の Webview であるため、VS Code テーマ変数との整合を優先する。

---

## 3. 修正対象

主な修正対象は以下とする。

```text
src/dashboard/dashboardStyles.ts
src/dashboard/dashboardWebviewScript.ts
src/dashboard/dashboardHtml.ts
src/dashboard/DashboardController.ts
src/dashboard/dashboardProtocol.ts
src/dashboard/dashboardMessageValidation.ts
src/dashboard/viewModels/ticketDashboardViewModel.ts
src/views/ticketEditorContent.ts
src/views/ticketMetadataYaml.ts
src/views/ticketMetadataControlFields.ts
src/redmine/types.ts
src/redmine/issues.ts
src/test/**/*.test.ts
```

---

## 4. チケット一覧の可読性改善

### 4.1 課題

チケット一覧の `#97` のような ID 表示が暗く、背景と同化して見づらい。

また、ID と同じ muted 系カラーを利用している以下の要素も、テーマによっては視認性が低い。

- チケット ID
- 子チケットコネクタ
- 展開アイコン
- チケット操作アイコン
- タブの非選択文字
- コメント日付
- 未同期詳細テキスト
- 設定セクション見出し
- 空状態メッセージ
- placeholder

### 4.2 修正方針

従来の `--app-text-muted` をそのまま使うのではなく、可読性用の muted token を追加する。

```css
body {
  --app-text-readable-muted: var(--vscode-descriptionForeground, #45515e);
}

body.vscode-light {
  --app-text-readable-muted: #45515e;
}

body.vscode-dark {
  --app-text-readable-muted: var(--vscode-descriptionForeground, #c8d2dc);
}

body.vscode-high-contrast {
  --app-text-readable-muted: var(--vscode-foreground);
}
```

### 4.3 チケット ID 表示

チケット ID は単なる薄いテキストではなく、軽量 badge として表示する。

```css
.ticket-id {
  color: var(--app-text-readable-muted);
  font-weight: 700;
  min-width: auto;
  padding: 1px 6px;
  border: 1px solid var(--app-card-border);
  border-radius: var(--mm-radius-pill);
  background: var(--app-surface-subtle);
  font-variant-numeric: tabular-nums;
}
```

### 4.4 その他 muted 要素

以下は `--app-text-readable-muted` を使用する。

```css
.child-connector,
.expand-btn,
.ticket-action-btn,
.tab,
.btn-icon,
.toggle-children,
.badge,
.unsynced-kind-label,
.unsynced-detail,
.comment-date,
.comments-header-label,
.setting-value,
.settings-section h3,
.settings-reset-btn,
.state-msg {
  color: var(--app-text-readable-muted);
}
```

### 4.5 期待結果

- チケット ID が背景に沈まない。
- ライト / ダーク / ハイコントラストで最低限の可読性が維持される。
- ID は一覧の視線誘導要素として機能する。

---

## 5. 設定タブの重複整理

### 5.1 課題

Webview 上に既に存在する操作と、Settings タブにある設定項目が重複している。

特に以下が重複している。

| 項目 | 既存 UI | Settings タブ | 方針 |
|---|---|---|---|
| 件名検索 | Tickets タブの検索ボックス | チケットフィルター > 件名検索 | Settings から外す |
| 子プロジェクトを含める | Header の checkbox | 一般 > 子プロジェクトを含める | Settings から外す |

### 5.2 残す設定

以下は一覧上に直接 UI がないため、Settings タブに残す。

- 並び替えフィールド
- 並び順
- 期日インジケーター
- オフライン同期モード
- チケット取得件数

### 5.3 修正仕様

Settings タブから次の項目を削除する。

- `件名検索`
- `子プロジェクトを含める`

ただし、既存の内部設定値・保存ロジック・テスト互換性は維持する。

### 5.4 実装方針

第一段階では、Webview UI から非表示または生成対象外にする。

推奨は `renderSettings()` の HTML 生成から該当項目を削除すること。

暫定対応として CSS で隠す場合は以下も可能だが、長期的には HTML 生成から除去する。

```css
.settings-section:has(#set-subject),
.setting-row:has(#set-include-children) {
  display: none;
}
```

### 5.5 期待結果

- ユーザーが同じ設定を複数箇所で見ずに済む。
- Dashboard の主操作は Header / Tickets タブに集約される。
- Settings タブは高度な表示制御・同期設定に限定される。

---

## 6. チケット行操作の改善

### 6.1 課題

現在のチケット行操作アイコンは hover / focus / selected 時のみ見えるため、操作が発見しづらい。

### 6.2 修正仕様

チケット操作アイコンは薄く常時表示する。

```css
.ticket-action-btn {
  opacity: .45;
  pointer-events: auto;
}

.ticket-row:hover .ticket-action-btn,
.ticket-row:focus-within .ticket-action-btn,
.ticket-row.selected .ticket-action-btn,
.ticket-action-btn[aria-expanded="true"] {
  opacity: 1;
}
```

### 6.3 操作内容

行操作メニューには以下を表示する。

- エディタで開く
- コメント追加
- ブラウザで開く
- 子チケット作成

### 6.4 期待結果

- 操作可能であることが常に分かる。
- hover に依存しない。
- キーボード操作でも到達できる。

---

## 7. 選択チケット詳細カード

### 7.1 課題

チケットを選択しても、コメントや詳細を確認するには Comments タブへの移動が必要であり、作業導線が分断されている。

### 7.2 修正仕様

Tickets タブ内に、選択中チケットの詳細カードを表示する。

表示位置は、Activity Bar の狭さを考慮し、チケット一覧の下部に sticky / collapsible card として配置する。

### 7.3 表示項目

詳細カードには以下を表示する。

- チケット ID
- チケット件名
- プロジェクト名
- プロジェクト ID
- 親チケット ID
- 親チケット件名
- トラッカー
- 優先度
- ステータス
- 期日
- 最終同期日時
- 同期状態

### 7.4 操作ボタン

詳細カードには以下の操作を配置する。

- エディタで開く
- コメント追加
- ブラウザで開く
- 子チケット作成
- 同期

### 7.5 コメント表示

詳細カード内に最新コメントを最大 3 件表示する。

全件確認は Comments タブで行う。

### 7.6 UI イメージ

```text
┌──────────────────────────────┐
│ #97 ログイン時にエラーが出る     │
│ Sample Project / ID: 12       │
│ Parent: #45 認証機能の改善      │
│                              │
│ Tracker   [Bug          ▼]   │
│ Priority  [Normal       ▼]   │
│ Status    [New          ▼]   │
│ Due date  [未設定        📅] │
│                              │
│ [Open] [Add comment] [Sync]  │
└──────────────────────────────┘
```

### 7.7 期待結果

- ユーザーが選択中チケットの文脈を即座に把握できる。
- コメント追加のために Comments タブへ移動する必要がなくなる。
- 親子チケットの文脈が明確になる。

---

## 8. チケット編集ヘッダの Webview 統合

### 8.1 課題

現在の Markdown frontmatter は、同期用メタデータとしては機能しているが、人間が編集対象を把握する UI としては弱い。

現状例:

```yaml
---
mode: ticket-update
issue_id: 97
last_synced_at: 2026-04-29T03:10:42.844Z
issue:
  tracker:   Bug
  priority:  Normal
  status:    New
  due_date:
---
```

この形式では、以下が分かりづらい。

- どのプロジェクトのチケットか
- 親チケットは何か
- 現在のチケット件名は何か
- tracker / priority / status に何を選べばよいか

### 8.2 採用方針

ヘッダ情報の人間向け表示と選択操作は Webview に統合する。

ただし、frontmatter は同期用の最小メタデータとして残す。

### 8.3 Markdown frontmatter の最小構成

```yaml
---
mode: ticket-update
project_id: 12
issue_id: 97
parent_issue_id: 45
last_synced_at: 2026-04-29T03:10:42.844Z
issue:
  tracker: Bug
  priority: Normal
  status: New
  due_date:
---
```

### 8.4 Webview に移す情報

以下は Webview の詳細カードで表示する。

- project name
- project ID
- issue ID
- issue subject
- parent issue ID
- parent issue subject
- tracker
- priority
- status
- due date
- last synced

### 8.5 frontmatter に追加しない方がよい表示専用項目

原則として、以下は frontmatter に追加しない。

- `project_name`
- `issue_subject`
- `parent_issue_subject`

理由:

- Markdown の冗長性が増える。
- H1 件名と `issue_subject` のどちらが正か分かりづらくなる。
- 表示専用情報と同期対象情報が混ざる。

### 8.6 例外

オフライン状態で Webview が情報を復元できない場合に限り、表示専用スナップショットを control field として保存する案は許容する。

ただし、その場合も `issue:` ブロックには入れない。

---

## 9. tracker / priority / status 選択 UX

### 9.1 課題

`tracker: Bug` のような手入力は、ユーザーが Redmine の有効な選択肢を知らない場合に使いづらい。

### 9.2 修正仕様

Webview の詳細カードで以下を選択可能にする。

- Tracker
- Priority
- Status
- Due date

### 9.3 選択 UI

第一候補は Webview 内の select / combobox とする。

ただし、選択肢が多い場合やプロジェクト別に制約がある場合は、VS Code QuickPick の併用も許可する。

### 9.4 データ取得

既存の Redmine API 関数を利用する。

- `listTrackers()`
- `listIssueStatuses()`
- `listIssuePriorities()`

将来的には project_id ごとの有効 tracker / status 遷移制約に対応する。

### 9.5 更新フロー

```text
Webview select 変更
  ↓
postMessage: ticket.metadata.update
  ↓
DashboardController が active editor / 対象 ticket editor を特定
  ↓
Markdown frontmatter の issue.tracker / issue.priority / issue.status / issue.due_date を更新
  ↓
ローカル draft / offline sync queue に反映
  ↓
Webview state 更新
```

### 9.6 注意点

Webview state だけを同期元にしない。

最終的な同期ソースは、既存の Markdown parser で読める frontmatter とする。

---

## 10. Webview message protocol 拡張

### 10.1 追加メッセージ

以下を追加する。

```ts
type DashboardRequest =
  | { type: "ticket.metadata.update"; requestId: string; ticketId: number; patch: TicketMetadataPatch }
  | ...;

type TicketMetadataPatch = {
  tracker?: string;
  priority?: string;
  status?: string;
  due_date?: string;
};
```

### 10.2 バリデーション

`dashboardMessageValidation.ts` に以下の検証を追加する。

- `ticketId` は positive integer
- `patch` は object
- `tracker / priority / status` は string
- `due_date` は空文字または `YYYY-MM-DD`
- 未知キーは拒否

### 10.3 エラー処理

validation failure は silent return ではなく、開発者向けに warning log を出す。

```ts
console.warn(`[Redmine Dashboard] Invalid message: ${result.reason}`);
```

ユーザー向け toast は出さない。

---

## 11. Redmine データモデル拡張

### 11.1 Ticket 型

`Ticket` に `projectName?: string` を追加する。

```ts
export interface Ticket {
  projectId: number;
  projectName?: string;
}
```

### 11.2 API 変換

`listIssues()` と `getIssueDetail()` で `issue.project.name` を `projectName` に設定する。

```ts
projectName: issue.project.name,
```

### 11.3 親チケット件名

親チケット件名は、初期段階では既に読み込まれているチケット一覧から解決する。

解決できない場合は `parentId` のみ表示する。

```text
Parent: #45
```

将来的には `getIssueDetail(parentId)` により遅延取得する。

---

## 12. Dashboard view model 拡張

### 12.1 Ticket node

チケット一覧 node に以下を追加する。

```ts
projectId: number;
projectName?: string;
parentId?: number;
parentSubject?: string;
trackerName?: string;
priorityName?: string;
statusName?: string;
dueDate?: string;
lastSyncedAt?: string;
```

### 12.2 Selected ticket detail

`selectedTicket` view model に以下を持たせる。

```ts
type DashboardSelectedTicket = {
  id: number;
  subject: string;
  projectId: number;
  projectName?: string;
  parentId?: number;
  parentSubject?: string;
  tracker?: string;
  priority?: string;
  status?: string;
  dueDate?: string;
  syncState?: string;
  lastSyncedAt?: string;
};
```

---

## 13. 未同期ファイル操作

### 13.1 破棄の文言

未同期の「破棄」は Redmine サーバ上のチケット削除ではないため、UI 文言を明確にする。

推奨文言:

```text
未同期のローカル変更を破棄します。Redmine 上のチケットは削除されません。
```

### 13.2 新規チケット作成後のローカル反映失敗

新規チケット作成が Redmine 側で成功したが、ローカルファイルへの ID 反映に失敗した場合、単純な `failed` ではなく専用状態を検討する。

候補:

```ts
{ status: "created_local_rewrite_failed" }
```

これにより、次回同期で重複作成するリスクを避ける。

---

## 14. Webview script 保守性

### 14.1 課題

`dashboardWebviewScript.ts` が巨大な文字列になっており、タブ制御、チケット描画、未同期、コメント、設定、toast が混在している。

### 14.2 修正方針

段階的に分割する。

推奨構成:

```text
src/dashboard/webview/
  app.ts
  state.ts
  messaging.ts
  renderTickets.ts
  renderTicketDetail.ts
  renderUnsynced.ts
  renderComments.ts
  renderSettings.ts
  accessibility.ts
  dom.ts
```

### 14.3 初期対応

ビルド構成変更が大きい場合は、まず関数単位で責務を明確化する。

最低限、以下は分離する。

- `renderTickets()`
- `renderTicketDetail()`
- `renderUnsynced()`
- `renderComments()`
- `renderSettings()`
- `updateSyncButtonStates()`
- `showToast()`

---

## 15. テスト仕様

### 15.1 既存テスト

以下は必ず維持する。

```bash
pnpm run lint
pnpm run compile-tests
pnpm run test
pnpm run package
```

### 15.2 追加テスト

#### Dashboard 表示

- チケット ID が badge 表示に必要な class を持つこと
- selected ticket detail が表示されること
- projectName がある場合は表示されること
- parentSubject がある場合は表示されること
- parentSubject がない場合は parentId のみ表示されること

#### Settings 重複整理

- Settings に `件名検索` が表示されないこと
- Settings に `子プロジェクトを含める` が表示されないこと
- Header の子プロジェクト checkbox は動作すること
- Tickets タブの検索ボックスは動作すること

#### Metadata 更新

- `ticket.metadata.update` が validation を通ること
- 不正な `due_date` は拒否されること
- 未知 key は拒否されること
- Webview から tracker を変更すると frontmatter が更新されること
- Webview から status を変更すると frontmatter が更新されること
- Webview から due_date を空にできること

#### 同期安全性

- 既存の frontmatter が引き続き parse できること
- display-only 情報がなくても同期できること
- Webview state だけに依存せず、Markdown frontmatter から同期できること

#### アクセシビリティ

- チケット操作ボタンが hover なしでも到達可能であること
- Escape で操作メニューが閉じること
- Enter でチケット選択できること
- tablist の左右キー移動が維持されること

---

## 16. 非対象

本修正では以下は対象外とする。

- Redmine のプロジェクト別 tracker 制約の完全対応
- Redmine の status transition 制約の完全対応
- TreeView UI の完全削除
- Markdown frontmatter の完全廃止
- Webview 全面 React 化
- Redmine 側チケット削除機能

---

## 17. 実装順序

### Step 1: 可読性改善

- `--app-text-readable-muted` を追加
- `.ticket-id` を badge 化
- muted 系要素を readable muted に変更

### Step 2: Settings 重複整理

- `件名検索` を Settings から削除
- `子プロジェクトを含める` を Settings から削除
- Header / Tickets タブ側の UI を正とする

### Step 3: Selected ticket detail card

- ViewModel 拡張
- Webview 表示追加
- コメント最新 3 件表示
- 操作ボタン追加

### Step 4: Ticket context データ拡張

- `Ticket.projectName` 追加
- `listIssues()` / `getIssueDetail()` で projectName 設定
- parent subject 解決

### Step 5: Metadata Webview 編集

- protocol 追加
- validation 追加
- controller handler 追加
- active editor frontmatter 更新処理追加

### Step 6: テスト追加

- 表示テスト
- validation テスト
- frontmatter 更新テスト
- Settings 重複削除テスト

---

## 18. 受け入れ条件

以下を満たすこと。

- チケット ID と補助テキストがライト / ダーク / ハイコントラストで読みやすい。
- Settings タブに Webview 上の操作と重複する項目が表示されない。
- ユーザーが選択中チケットの project / parent / tracker / status / priority / due date を Webview で確認できる。
- tracker / priority / status / due_date を Webview から変更できる。
- Markdown frontmatter は同期用の最小メタデータとして残る。
- 既存の Markdown ファイルが引き続き parse できる。
- Webview state だけに依存せず、frontmatter から同期できる。
- `pnpm run lint` が成功する。
- `pnpm run compile-tests` が成功する。
- `pnpm run test` が成功する。
- `pnpm run package` が成功する。

---

## 19. Codex 実装指示サマリ

```text
Implement Dashboard Webview UX improvements for vs-redmine-client.

Focus areas:
1. Improve readability of ticket IDs and muted text.
2. Remove duplicated Settings UI items already present in the main Webview.
3. Add selected ticket detail/context card in Tickets tab.
4. Move human-facing ticket header context into Webview while keeping minimal Markdown frontmatter for sync safety.
5. Allow tracker/priority/status/due_date edits from Webview controls by updating the active ticket editor frontmatter.
6. Add validation, tests, and keep existing sync behavior compatible.

Do not remove frontmatter.
Do not make Webview state the only sync source.
Follow DESIGN.md.
Preserve existing tests and commands.
```
