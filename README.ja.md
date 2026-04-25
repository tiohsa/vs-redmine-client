# Redmine Client

Redmine Client は Redmine 6.1 のチケット運用を VS Code に統合します。プロジェクトの参照、チケットの検索・確認・作成、コメントの編集、変更の同期まで、エディタ内で完結できます。

English README: `README.md`

## 特長

- Activity Bar に 5 つの専用ビュー: Ticket Settings / Open Editors / Projects / Tickets / Comments
- ステータス・優先度・トラッカー・担当者・タイトルによるチケット絞り込み
- ワンクリックでチケット・コメントをエディタでプレビュー
- アクティブエディタまたはチケット一覧から新規チケット作成（子チケット作成にも対応）
- エディタタイトルバーの同期ボタン（`Redmine: Sync to Redmine`）で明示的に保存
- チケットエディタのフォーカス中はステータスバーにチケット番号を表示
- **Markdown画像の自動アップロード**: エディタに貼り付けた画像は保存時に自動アップロード
- Mermaid ブロックを redmica_ui_extension 形式（`{{mermaid ... }}`）に変換
- 自分のコメントのみ安全に編集
- **競合検出と差分表示**: リモートの変更を保存前に検出し、差分エディタで競合解決
- **オフライン同期モード**: 保存をキューに貯めて手動で反映
- **ドラフト永続化**: チケット・コメントのドラフトは VS Code 再起動後も保持

## 必要要件

- Redmine 6.1 サーバー
- 対象プロジェクトにアクセス可能な API キー

## クイックスタート

1. VS Code の設定で `redmine-client.baseUrl` と `redmine-client.apiKey` を設定する。
2. `redmine-client.defaultProjectId` を設定するか、**Projects** ビューでプロジェクトを選択する。
3. Activity Bar の **Projects** ビューでプロジェクトをクリックして選択する。
4. **Tickets** ビューでチケットをクリックするとエディタが開く。
5. 編集して保存すれば自動同期される（オフラインモードの場合はキューに追加）。
6. （任意）`<editorStorageDirectory>/templates` にテンプレートを置くと新規作成に適用される。

## Activity Bar ビュー

| ビュー | 説明 |
|--------|------|
| **Ticket Settings** | フィルタ・ソート・期日表示・エディタデフォルト値・オフライン同期モードを設定 |
| **Open Editors** | 現在開いているチケット・コメントエディタ一覧。クリックでフォーカス |
| **Projects** | プロジェクト選択。オフライン同期キューがある場合は同期アイコンを表示 |
| **Tickets** | チケットの一覧・絞り込み・検索・新規作成 |
| **Comments** | 選択中チケットのコメント一覧と編集 |

![Activity Bar ビュー](./images/view.png)

## 設定項目

| 設定キー | デフォルト | 説明 |
|---------|----------|------|
| `redmine-client.baseUrl` | `""` | Redmine のベースURL（`http://` または `https://` を含める） |
| `redmine-client.apiKey` | `""` | Redmine API キー |
| `redmine-client.ignoreSSLErrors` | `false` | SSL証明書エラーを無視する（自己署名証明書など） |
| `redmine-client.defaultProjectId` | `""` | デフォルトのプロジェクトID/識別子 |
| `redmine-client.includeChildProjects` | `false` | 子プロジェクトを一覧に含めるか |
| `redmine-client.ticketListLimit` | `50` | 取得するチケット件数 |
| `redmine-client.editorStorageDirectory` | `""` | エディタファイルの保存先（空の場合はワークスペース既定値） |
| `redmine-client.newTicketTemplatePath` | `""` | 新規チケットテンプレートファイルへの絶対パス |
| `redmine-client.offlineSyncMode` | `"auto"` | 同期モード: `auto`（即時送信）/ `manual`（キューに追加） |

## チケット一覧設定

**Ticket Settings** ビューまたはコマンドからチケット一覧の表示をカスタマイズできます。

### フィルタ

- **タイトル**: 件名のキーワードで絞り込み
- **ステータス**: 特定のステータスのチケットのみ表示
- **優先度**: 特定の優先度のチケットのみ表示
- **トラッカー**: 特定のトラッカーのチケットのみ表示
- **担当者**: 特定の担当者のチケットのみ表示

### 並び替え

- **ソート**: 優先度・ステータス・期日などで並び替え
- **期日表示**: チケット一覧に期日を表示

### 関連チケット絞り込み

Tickets ビューのタイトルバーにある絞り込みアイコン（`Redmine: 絞り込み表示切替`）をクリックすると、現在開いているエディタに関連するチケットのみ表示するモードに切り替わります。

### エディタのデフォルト値

新規チケット作成時に適用されるデフォルト値を設定できます:

- **件名 (Subject)**、**説明 (Description)**、**トラッカー (Tracker)**、**優先度 (Priority)**、**ステータス (Status)**、**期日 (Due date)**

## テンプレート

テンプレートは `<editorStorageDirectory>/templates` 配下に配置します。

- **プロジェクト別テンプレート**: ファイル名にプロジェクト名の完全一致を含める（大文字小文字は無視）。
- **既定テンプレート**: `default.md`（該当テンプレートがない場合に使用）。
- **単一ファイル指定**: `redmine-client.newTicketTemplatePath` で絶対パスを直接指定することも可能。

### テンプレートサンプル

```markdown
---
issue:
  tracker:   Bug
  priority:  Low
  status:    New
  due_date:  
---

# 件名をここに記述

詳細説明。
```

## コマンド

### ビュー操作

| コマンド | 説明 |
|---------|------|
| `Redmine: Refresh Projects` | プロジェクト一覧を再読み込み |
| `Redmine: Refresh Tickets` | チケット一覧を再読み込み |
| `Redmine: Refresh Comments` | コメント一覧を再読み込み |
| `Redmine: Reload Project` | 選択中プロジェクトを再読み込み |
| `Redmine: Reload Ticket` | アクティブなチケットエディタを Redmine から再読み込み |
| `Redmine: Reload Comment` | アクティブなコメントエディタを Redmine から再読み込み |
| `Redmine: Collapse All Projects` | プロジェクトツリーをすべて折りたたむ |
| `Redmine: Collapse All Tickets` | チケットツリーをすべて折りたたむ |
| `Redmine: Select Project` | プロジェクトIDを入力してアクティブプロジェクトを切り替え |
| `Redmine: Toggle Child Projects` | 子プロジェクトをチケット一覧に含める/除外する |
| `Redmine: Search Tickets` | キーワードでチケットを検索 |
| `Redmine: 絞り込み表示切替` | 関連チケット絞り込みの ON/OFF を切り替え |

### チケット操作

| コマンド | 説明 |
|---------|------|
| `Redmine: Open Ticket Preview` | 読み取り専用のチケットプレビューをエディタで開く |
| `Redmine: Open Ticket Editor (New)` | 追加のチケットエディタを開く |
| `Redmine: Create Ticket from Editor` | アクティブエディタの内容から新規チケットを作成 |
| `Redmine: New Ticket` | 選択中プロジェクトに空の新規チケットエディタを開く |
| `Redmine: Add Child Ticket` | 選択中チケットの子チケットを作成 |
| `Redmine: Sync to Redmine` | アクティブなチケット/コメントエディタを明示的に Redmine へ同期 |
| `Redmine: Focus Active Ticket in Tree` | アクティブなチケットエディタのチケットをツリーで表示 |
| `Redmine: Focus Open Ticket Editor` | 選択チケットの開いているエディタをフォーカス |

### コメント操作

| コマンド | 説明 |
|---------|------|
| `Redmine: Edit Comment` | 選択中のコメントをエディタで開く |
| `Redmine: Add Comment` | 選択中チケットに新規コメントを追加 |

### ブラウザで開く

| コマンド | 説明 |
|---------|------|
| `Redmine: Open Project in Browser` | 選択中プロジェクトをブラウザで開く |
| `Redmine: Open Ticket in Browser` | 選択中チケットをブラウザで開く |
| `Redmine: Open Comment in Browser` | 選択中コメントをブラウザで開く |

### チケット一覧設定

| コマンド | 説明 |
|---------|------|
| `Redmine: Configure Ticket Title Filter` | タイトル（件名）によるキーワード絞り込みを設定 |
| `Redmine: Configure Ticket Priority Filter` | 優先度フィルタを設定 |
| `Redmine: Configure Ticket Status Filter` | ステータスフィルタを設定 |
| `Redmine: Configure Ticket Tracker Filter` | トラッカーフィルタを設定 |
| `Redmine: Configure Ticket Assignee Filter` | 担当者フィルタを設定 |
| `Redmine: Configure Ticket Sort` | ソート順を設定 |
| `Redmine: Configure Ticket Due Date Display` | 期日表示ルールを設定 |
| `Redmine: Reset Ticket Settings` | チケット一覧設定をすべてリセット |

### エディタデフォルト値設定

| コマンド | 説明 |
|---------|------|
| `Redmine: Configure Editor Default Subject` | デフォルトの件名を設定 |
| `Redmine: Configure Editor Default Description` | デフォルトの説明文を設定 |
| `Redmine: Configure Editor Default Tracker` | デフォルトのトラッカーを設定 |
| `Redmine: Configure Editor Default Priority` | デフォルトの優先度を設定 |
| `Redmine: Configure Editor Default Status` | デフォルトのステータスを設定 |
| `Redmine: Configure Editor Default Due Date` | デフォルトの期日を設定 |
| `Redmine: Reset Editor Defaults` | エディタデフォルト値をすべてクリア |

### オフライン同期

| コマンド | 説明 |
|---------|------|
| `Redmine: Run Offline Sync` | キューに貯まった保存をすべてアップロード |
| `Redmine: Configure Offline Sync Mode` | `auto` / `manual` を切り替え |

## ヒント

- **同期ボタン**: エディタタイトルバーの `$(cloud-upload)` アイコンから `Redmine: Sync to Redmine` を実行できます。オートセーブ有効時に便利です。
- **ドラフト永続化**: チケット・コメントのドラフトは VS Code のグローバルストレージに保存され、再起動後も保持されます。
- **画像ペースト**: ファイルベースのエディタに画像を直接貼り付けると、保存時に自動アップロードされます。Untitled エディタの場合は先にファイル保存してください。
- **競合解決**: リモートで変更が検出された場合、「ローカル優先」「リモート優先」「差分を確認」から選択できます。
- **オフライン同期**: モードを `manual` にすると保存がキューされ、`Redmine: Run Offline Sync` または Projects ビューのアイコンで反映できます。
- **Mermaid**: `mermaid` コードブロックは `{{mermaid ... }}` に変換して投稿されます。
- **ブラウザで開く**: ツリー上のプロジェクト・チケット・コメントを右クリックして「Open in Browser」を選択できます。
- **ステータスバー**: チケットエディタがアクティブなとき、ステータスバーにチケット番号が表示されます。

## デバッグ

1. VS Code でこのリポジトリを開く。
2. **Run Extension** デバッグ構成を実行する（F5）。
3. Extension Host ウィンドウで設定を入力する。
4. 上記のコマンドで動作確認する。

## テスト

```bash
pnpm test              # コンパイル + Lint + VS Code 統合テスト
pnpm run test:unsafe   # サンドボックス制限環境向けのテスト
```

## 既知の問題

- クリップボード添付は data URI 形式が必要。
- 画像ペーストはファイルベースのエディタでのみ利用可能。Untitled エディタ（新規チケット/コメントドラフト）では、一度ファイル保存してから画像をペーストしてください。

## ライセンス

MIT
