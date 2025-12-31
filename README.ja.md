# Redmine Client

Redmine Client は Redmine 6.1 のチケット運用を VS Code に統合します。プロジェクトの参照、チケットの検索と確認、エディタ内容からの新規チケット作成、コメントの編集までをエディタ内で完結できます。

English README: `README.md`

## 特長

- Activity Bar に Projects / Tickets / Comments の専用ビュー
- ステータスや担当者で絞り込めるチケット一覧
- エディタ内の読み取り専用プレビュー
- アクティブエディタの内容からチケットを作成
- ファイルまたはクリップボード data URI から添付
- **Markdown画像の自動アップロード**: エディタに貼り付けた画像は保存時に自動でアップロード
- Mermaid ブロックを redmica_ui_extension 形式（`{{mermaid ... }}`）に変換
- 自分のコメントのみ安全に編集
- **競合検出と差分表示**: リモートの変更を保存前に検出し、差分エディタで競合解決

## 必要要件

- Redmine 6.1 サーバー
- 対象プロジェクトにアクセス可能な API キー

## クイックスタート

1. `redmine-client.baseUrl` と `redmine-client.apiKey` を設定する。
2. `redmine-client.defaultProjectId` を設定、またはコマンドで選択する。
3. **Projects** ビューでプロジェクトを選ぶ。
4. **Tickets** でチケットを確認し、プレビューを開く。
5. コマンドで作成・更新を行う。
6. （任意）`<editorStorageDirectory>/templates` にテンプレートを置くと新規作成に適用される。

## Activity Bar ビュー

- **Projects**: プロジェクト選択（リフレッシュ・リロードアイコン）
- **Tickets**: チケットの一覧とフィルタ（リフレッシュ・リロード・折りたたみアイコン）
- **Comments**: コメントの参照と編集（リフレッシュ・リロードアイコン）

![alt text](image.png)

## 設定項目

- `redmine-client.baseUrl`: Redmine のベースURL（http:// または https:// を含める）
- `redmine-client.apiKey`: Redmine API キー
- `redmine-client.defaultProjectId`: デフォルトのプロジェクトID/識別子
- `redmine-client.includeChildProjects`: 子プロジェクトを一覧に含めるか
- `redmine-client.ticketListLimit`: 取得するチケット件数（デフォルト50）
- `redmine-client.editorStorageDirectory`: エディタファイルとテンプレートの保存先ディレクトリ

## チケット一覧設定

Ticket Settings ビューからチケット一覧の表示をカスタマイズできます。

### フィルタ

- **ステータス**: 特定のステータスのチケットのみ表示
- **優先度**: 特定の優先度のチケットのみ表示
- **トラッカー**: 特定のトラッカーのチケットのみ表示
- **担当者**: 特定の担当者のチケットのみ表示

### 並び替え

- **ソート**: チケットを優先度、ステータス、期日などで並び替え
- **期日表示**: チケット一覧に期日を表示

### エディタのデフォルト値

新規チケット作成時のデフォルト値を設定できます:

- **Subject**: デフォルトの件名
- **Description**: デフォルトの説明文
- **Tracker**: デフォルトのトラッカー
- **Priority**: デフォルトの優先度
- **Status**: デフォルトのステータス
- **Due date**: デフォルトの期日

## テンプレート

テンプレートは `<editorStorageDirectory>/templates` 配下に配置します。

- プロジェクト別テンプレート: ファイル名にプロジェクト名の完全一致を含める（大文字小文字は無視）。
- 既定テンプレート: `default.md`（該当テンプレートがない、または複数一致時に使用）。

### テンプレートサンプル

```markdown
---
issue:
  tracker:   Bug
  priority:  Low
  status:    New
  due_date:  
---

# Subproject issue two

This is a second issue on a cookbook subproject
```

## コマンド

- `Redmine: Refresh Projects`
- `Redmine: Refresh Tickets`
- `Redmine: Refresh Comments`
- `Redmine: Reload Project`
- `Redmine: Reload Ticket`
- `Redmine: Reload Comment`
- `Redmine: Select Project`
- `Redmine: Toggle Child Projects`
- `Redmine: Open Ticket Preview`
- `Redmine: Create Ticket from Editor`
- `Redmine: Edit Comment`
- `Redmine: Add Comment`
- `Redmine: Configure Ticket Priority Filter`
- `Redmine: Configure Ticket Status Filter`
- `Redmine: Configure Ticket Tracker Filter`
- `Redmine: Configure Ticket Assignee Filter`
- `Redmine: Configure Ticket Sort`
- `Redmine: Reset Ticket Settings`

## ヒント

- 添付はファイルまたはクリップボードの data URI を利用できます。
- Mermaid ブロックは `{{mermaid ... }}` に変換して投稿されます。
- 画像ペースト: エディタに直接画像を貼り付けると、保存時に自動でアップロードされます。
- 競合解決: リモートで変更が検出された場合、「ローカル優先」「リモート優先」「差分を確認」から選択できます。

## デバッグ

1. VS Code でこのリポジトリを開く。
2. "Run Extension" を実行（F5）。
3. Extension Host 側で設定を投入する。
4. 上記コマンドで動作確認する。

## テスト

- `pnpm test`: コンパイル + Lint + VS Code 統合テスト
- `pnpm run test:unsafe`: サンドボックス制限環境向けのテスト

## 既知の問題

- クリップボード添付は data URI 形式が必要。
- 画像ペーストはファイルベースのエディタでのみ利用可能。新規チケット/コメントのドラフト（untitledエディタ）では、一度保存してから画像をペーストしてください。

## ライセンス

MIT
