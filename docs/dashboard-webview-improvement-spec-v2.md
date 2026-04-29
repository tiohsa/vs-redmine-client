# 修正仕様書 v2: Dashboard Webview 改善

対象リポジトリ: `tiohsa/vs-redmine-client`  
対象ブランチ: `claude/stabilize-dashboard-webview-o0B0a`  
対象PR: #9 `リファクタリング`  
前版: `docs/dashboard-webview-improvement-spec.md`

---

## 0. 5人の専門家レビュー結果

### 0.1 VS Code 拡張アーキテクト

#### 指摘

前版の仕様は、Dashboard Webview を主 UI とする方針は妥当だが、Webview から metadata を更新する対象が曖昧だった。

特に次が未定義だった。

- 対象チケットの editor が開いている場合
- 対象チケットの editor が閉じている場合
- 未同期 queue だけが存在する場合
- Webview の選択チケットと active editor が異なる場合

#### 改善

Webview metadata 更新は、active editor ではなく `ticketId` を基準に対象を解決する。

優先順位は以下とする。

1. `ticketId` に対応する登録済み editor document
2. 未同期 queue 内の該当 ticket update / new ticket draft
3. 必要に応じて ticket editor を開いてから更新
4. いずれも特定できない場合はエラー表示

active editor は補助情報としてのみ扱い、主キーにしない。

---

### 0.2 UI/UX 専門家

#### 指摘

前版は「詳細カードを追加する」としているが、Activity Bar の横幅制約に対して情報量が多すぎる。常時展開の詳細カードは一覧の可視領域を圧迫する可能性がある。

#### 改善

詳細カードは `compact / expanded` の2状態にする。

- compact: 常時表示。ID、件名、プロジェクト、主要アクションのみ。
- expanded: tracker / priority / status / due_date / comments を表示。

初期状態は compact とし、選択チケットをクリックしたとき、または詳細カードの展開ボタンで expanded にする。

---

### 0.3 セキュリティ / データ保護専門家

#### 指摘

Webview から frontmatter を更新する場合、Webview state を信頼しすぎると危険である。

特に `ticket.metadata.update` では、Webview から渡された tracker/status/priority をそのまま frontmatter に書くと、Redmine に存在しない値や別プロジェクトで無効な値が混入する。

#### 改善

Webview からの更新値は次の二段階で検証する。

1. 型・形式の validation
2. Redmine から取得済みの選択肢リストとの照合

選択肢が未取得の場合は、metadata 更新 UI を read-only にする。

---

### 0.4 同期・競合制御専門家

#### 指摘

frontmatter を最小化する方針は妥当だが、Webview で選んだ値を保存した時点で、どのように draft / offline queue / sync state に反映するかが不足していた。

#### 改善

Webview から metadata を変更した場合は、既存の保存フローと同等に扱う。

- editor document を更新する
- `parseTicketEditorContent()` で再解析可能であることを確認する
- draft store を更新する
- offline sync queue に反映する
- Dashboard の selected ticket / unsynced count を refresh する

直接 Redmine へ送信しない。同期は既存の sync command に委譲する。

---

### 0.5 QA / テスト専門家

#### 指摘

前版のテスト仕様は網羅的だが、優先順位がないため実装量が膨らみやすい。

#### 改善

テストを P0 / P1 / P2 に分ける。

- P0: merge 前必須
- P1: 同一PR内で可能なら実施
- P2: 後続改善

---

## 1. 改善後の結論

本修正では、Dashboard Webview を主 UI として強化する。

ただし、Markdown frontmatter は完全には削除しない。

```text
Webview = 人間が見る・選ぶ・編集する UI
Markdown frontmatter = 同期・復元・競合検知のための最小メタデータ
Markdown body = 件名・説明本文
```

この方針により、以下を両立する。

- ユーザーは YAML を直接理解しなくても操作できる
- ローカルファイル単体でも同期対象を復元できる
- 既存の保存・同期・競合検知ロジックを破壊しない

---

## 2. スコープ

### 2.1 対象

- Dashboard Webview のチケット一覧可読性改善
- Settings タブの重複項目整理
- チケット行操作アイコンの discoverability 改善
- 選択チケット詳細カード追加
- Webview での tracker / priority / status / due_date 編集
- Markdown frontmatter の最小化方針整理
- Redmine ticket model の projectName 拡張
- message protocol / validation / tests 追加

### 2.2 非対象

- Markdown frontmatter の完全廃止
- Redmine 側チケット削除機能
- Redmine の status transition 制約の完全再現
- プロジェクト別 tracker 制約の完全再現
- TreeView 関連内部クラスの完全削除
- React / Vue 等への全面移行

---

## 3. 優先度

### P0: merge 前に必須

1. チケット ID と muted text の可読性改善
2. Settings タブから重複項目を削除
3. チケット行操作アイコンを薄く常時表示
4. Selected ticket detail card の compact 表示
5. `ticket.metadata.update` の protocol / validation 追加
6. Webview metadata 更新時に対象 ticket editor を `ticketId` 基準で解決
7. P0 テスト追加

### P1: 同一 PR 内で実施推奨

1. detail card の expanded 表示
2. tracker / priority / status の select UI
3. latest comments 最大3件表示
4. parent issue subject の解決
5. `DashboardMessageRouter` の invalid message warning log
6. Webview script の関数単位整理

### P2: 後続改善

1. project_id ごとの有効 tracker 取得
2. status transition 制約対応
3. detail card の状態永続化
4. Webview script の bundle 分割
5. legacy TreeView provider の service 化

---

## 4. 可読性改善仕様

### 4.1 readable muted token

`dashboardStyles.ts` に可読性用 token を追加する。

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

### 4.2 ticket ID badge

チケット ID は軽量 badge として表示する。

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

### 4.3 readable muted 適用対象

以下に `--app-text-readable-muted` を適用する。

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
.state-msg,
#search-input::placeholder {
  color: var(--app-text-readable-muted);
}
```

---

## 5. Settings タブ重複整理

### 5.1 削除する項目

Settings タブから以下を削除する。

| 削除項目 | 理由 | 正とする UI |
|---|---|---|
| 件名検索 | Tickets タブに検索 box がある | Tickets tab search input |
| 子プロジェクトを含める | Header に checkbox がある | Header checkbox |

### 5.2 残す項目

以下は残す。

- 並び替えフィールド
- 並び順
- 期日インジケーター
- オフライン同期モード
- チケット取得件数

### 5.3 実装ルール

CSS の `:has()` で隠すのは暫定対応とする。

正式対応では `renderSettings()` の HTML 生成から削除する。

理由:

- CSS 依存で DOM に不要要素が残る
- テストしづらい
- アクセシビリティ上、非表示要素の扱いが曖昧になる

---

## 6. チケット行操作

### 6.1 操作アイコン表示

チケット行操作アイコンは、薄く常時表示する。

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

### 6.2 操作メニュー

行操作メニューは以下を持つ。

- エディタで開く
- コメント追加
- ブラウザで開く
- 子チケット作成

### 6.3 キーボード操作

- Enter: チケット選択
- Space: 展開 / 折りたたみ対象が focus されている場合のみ展開操作
- Escape: 操作メニューを閉じる
- Tab: 操作ボタンへ移動可能

---

## 7. Selected Ticket Detail Card

### 7.1 基本方針

Tickets タブ内に選択チケットの detail card を追加する。

ただし Activity Bar の幅が狭いため、常時 full detail を出さない。

### 7.2 compact 表示

compact 表示では以下を表示する。

- `#issueId`
- subject
- project name / project id
- parent issue id / parent subject があれば表示
- 主要操作ボタン

### 7.3 expanded 表示

expanded 表示では以下も追加する。

- tracker
- priority
- status
- due date
- sync state
- last synced at
- latest comments 最大3件

### 7.4 UI 例

```text
┌──────────────────────────────┐
│ #97 ログイン時にエラーが出る     │
│ Sample Project / ID: 12       │
│ Parent: #45 認証機能の改善      │
│ [Open] [Comment] [Sync] [∨]  │
└──────────────────────────────┘
```

expanded:

```text
Tracker   [Bug       ▼]
Priority  [Normal    ▼]
Status    [New       ▼]
Due date  [未設定     📅]
Latest comments
- 2026-04-29 田中: 調査中です
```

### 7.5 表示位置

第一候補は Tickets タブ下部の sticky card とする。

ただし高さが不足する場合は、選択チケット行の直下に inline expandable detail として表示してもよい。

---

## 8. Markdown frontmatter 方針

### 8.1 残す最小 frontmatter

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

### 8.2 Webview に移す情報

以下は Webview で表示する。

- project name
- issue subject
- parent issue subject
- tracker / priority / status / due_date の選択 UI

### 8.3 frontmatter に原則追加しない項目

- `project_name`
- `issue_subject`
- `parent_issue_subject`

理由:

- Markdown が冗長になる
- H1 件名との二重管理になる
- 表示専用情報と同期対象情報が混ざる

### 8.4 例外

オフライン復元のために必要な場合のみ、display snapshot として control field に保存してよい。

ただし `issue:` ブロックには入れない。

---

## 9. Webview metadata 編集

### 9.1 編集対象

Webview から編集できる metadata は以下に限定する。

```ts
type TicketMetadataPatch = {
  tracker?: string;
  priority?: string;
  status?: string;
  due_date?: string;
};
```

### 9.2 message protocol

```ts
{
  type: "ticket.metadata.update",
  requestId: string,
  ticketId: number,
  patch: TicketMetadataPatch
}
```

### 9.3 validation

`dashboardMessageValidation.ts` で以下を検証する。

- `ticketId` は positive integer
- `patch` は object
- patch は許可された key のみ
- `tracker / priority / status` は non-empty string
- `due_date` は空文字または `YYYY-MM-DD`

### 9.4 選択肢照合

Controller 側で、取得済み選択肢と照合する。

- tracker は tracker list に含まれること
- priority は priority list に含まれること
- status は status list に含まれること

選択肢が未取得の場合は、Webview 上の select を disabled にする。

### 9.5 更新対象の解決順序

metadata 更新対象は `ticketId` を基準に解決する。

1. 登録済み ticket editor document
2. offline sync queue の ticket update
3. ticket editor を開いて document を作成
4. 失敗した場合は toast error

active editor が別 ticket の場合でも、誤って active editor を更新しない。

### 9.6 保存フロー

Webview metadata 更新時は、既存の保存処理と整合させる。

1. 対象 document の frontmatter を更新
2. `parseTicketEditorContent()` で再解析可能か確認
3. draft store を更新
4. offline sync queue に反映
5. Dashboard state を refresh
6. unsynced count を refresh

直接 Redmine へ送信しない。

---

## 10. Redmine データモデル拡張

### 10.1 Ticket 型

```ts
export interface Ticket {
  projectId: number;
  projectName?: string;
}
```

### 10.2 listIssues / getIssueDetail

Redmine response の `issue.project.name` を `projectName` に設定する。

```ts
projectName: issue.project.name,
```

### 10.3 parent subject 解決

第一段階では、読み込み済み ticket list から parent subject を解決する。

解決できない場合は parent ID のみ表示する。

```text
Parent: #45
```

---

## 11. 未同期操作

### 11.1 破棄文言

未同期変更の破棄は、Redmine サーバ上の削除ではない。

表示文言:

```text
未同期のローカル変更を破棄します。Redmine 上のチケットは削除されません。
```

### 11.2 作成済み・ローカル反映失敗

新規チケット作成が Redmine 側で成功したが、ローカルファイルへの ID 反映に失敗した場合は、専用 status を検討する。

```ts
{ status: "created_local_rewrite_failed" }
```

これにより再同期時の重複作成を避ける。

---

## 12. Webview script 保守性

### 12.1 原則

`dashboardWebviewScript.ts` の巨大化を止める。

### 12.2 P0 対応

まずは関数単位で責務を明確化する。

- `renderTickets()`
- `renderTicketDetail()`
- `renderUnsynced()`
- `renderComments()`
- `renderSettings()`
- `updateSyncButtonStates()`
- `showToast()`

### 12.3 P2 対応

将来的に以下へ分割する。

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

CSP nonce は維持する。

---

## 13. テスト仕様

### 13.1 P0 テスト

#### 可読性

- `.ticket-id` が badge 表示に必要な class / CSS を持つこと
- readable muted token が定義されていること

#### Settings 重複整理

- `件名検索` が Settings DOM に生成されないこと
- `子プロジェクトを含める` が Settings DOM に生成されないこと
- Header の子プロジェクト checkbox は動作すること
- Tickets tab の検索 box は動作すること

#### metadata update validation

- 正常な `ticket.metadata.update` が通ること
- 不正な `due_date` が拒否されること
- 未知 key が拒否されること
- 空 patch が拒否されること

#### 対象 editor 解決

- active editor が別チケットでも、指定 ticketId の editor が更新されること
- 指定 ticketId の editor がない場合、エラーになること

### 13.2 P1 テスト

- detail card compact が表示されること
- detail card expanded が表示されること
- tracker select 変更で frontmatter が更新されること
- priority select 変更で frontmatter が更新されること
- status select 変更で frontmatter が更新されること
- due_date を空文字にできること
- latest comments が最大3件表示されること

### 13.3 P2 テスト

- project_id ごとの tracker 制約
- status transition 制約
- detail card 状態永続化
- webview script 分割後の DOM 単体テスト

---

## 14. 受け入れ条件

### 14.1 UX

- チケット ID と補助テキストが読みやすい
- Settings タブに重複項目がない
- チケット行の操作アイコンが hover なしで発見できる
- 選択中チケットの project / parent / tracker / priority / status / due date が Webview で分かる
- tracker / priority / status / due_date を手入力せず選べる

### 14.2 データ安全性

- frontmatter は同期用最小メタデータとして残る
- 既存 Markdown ファイルが parse できる
- Webview state だけに依存して同期しない
- 不正 metadata update message は拒否される
- active editor 誤更新が起きない

### 14.3 CI

以下が成功すること。

```bash
pnpm run lint
pnpm run compile-tests
pnpm run test
pnpm run package
```

---

## 15. Codex 実装指示サマリ

```text
Improve the Dashboard Webview branch for vs-redmine-client.

Implement P0 first:
1. Improve muted text readability and ticket ID badge styling.
2. Remove duplicate Settings UI items from renderSettings(), not only via CSS.
3. Make ticket action buttons faintly visible by default.
4. Add compact selected ticket detail card.
5. Add ticket.metadata.update protocol and strict validation.
6. Resolve metadata update target by ticketId, not active editor.
7. Keep Markdown frontmatter as the sync source of truth.
8. Add P0 tests.

Then implement P1 if feasible:
1. Expanded detail card.
2. Metadata select controls for tracker/priority/status/due_date.
3. Latest comments preview.
4. Parent subject resolution.
5. Invalid message warning log.

Do not remove frontmatter.
Do not make Webview state the only sync source.
Do not rely on CSS :has() as the final Settings cleanup.
Follow DESIGN.md.
Keep existing sync behavior compatible.
```
