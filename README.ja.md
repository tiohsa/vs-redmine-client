# TodoEx

VS Code 上で Redmine 6.1 のチケット管理を完結できます。プロジェクト別のチケット一覧、
読み取り専用プレビュー、エディタ内容からのチケット作成、画像添付、
自分のコメント編集に対応します。

English README: `README.md`

## 主な機能

- サイドバーでチケット一覧（ステータス/担当者フィルタ）
- サイドバーでプロジェクト一覧（選択ハイライト）
- 子プロジェクトのチケットを含める切替
- エディタ内の読み取り専用プレビュー
- アクティブエディタ内容からチケット作成
- 画像添付（ファイル選択 / クリップボードの data URI）
- Mermaid ブロックを redmica_ui_extension 形式（`{{mermaid ... }}`）に変換
- 自分のコメントのみ編集可能
- コメント一覧ビュー

## 必要要件

- Redmine 6.1 サーバー
- 対象プロジェクトにアクセス可能な API キー

## 設定項目

- `todoex.baseUrl`: Redmine のベースURL（http:// または https:// を含める）
- `todoex.apiKey`: Redmine API キー
- `todoex.defaultProjectId`: デフォルトのプロジェクトID/識別子
- `todoex.includeChildProjects`: 子プロジェクトを一覧に含めるか
- `todoex.ticketListLimit`: 取得するチケット件数（デフォルト50）

## 使い方

1. `todoex.baseUrl`（http:// または https:// を含める）と `todoex.apiKey` を設定
2. `todoex.defaultProjectId` を設定（またはコマンドで選択）
3. サイドバーの "Redmine Tickets" で一覧を確認
4. "Redmine Projects" でプロジェクトを選択してチケットを表示
5. チケット選択でプレビューとコメントを表示
6. "Redmine: Create Ticket from Editor" で新規作成
7. "Redmine: Edit Comment" で自分のコメントをエディタ内容で更新

## コマンド

- `Redmine: Refresh Projects`
- `Redmine: Refresh Tickets`
- `Redmine: Select Project`
- `Redmine: Toggle Child Projects`
- `Redmine: Open Ticket Preview`
- `Redmine: Create Ticket from Editor`
- `Redmine: Edit Comment`
- `Redmine: Add Comment`

### コマンドの利用方法

#### Redmine: Refresh Projects

1. エクスプローラーの "Redmine Projects" を開く
2. コマンド実行でプロジェクト一覧を再読み込み

#### Redmine: Refresh Tickets

1. プロジェクトを選択しておく
2. "Redmine Tickets" を開く
3. コマンド実行で選択プロジェクトのチケットを再読み込み

#### Redmine: Select Project

1. コマンドを実行
2. 数値のプロジェクトIDを入力
3. チケットとコメントが選択プロジェクトに更新される

#### Redmine: Toggle Child Projects

1. コマンドを実行
2. 子プロジェクトを含む/含まないでチケット一覧を再読み込み

#### Redmine: Open Ticket Preview

1. "Redmine Tickets" でチケットを選択
2. コマンド実行で読み取り専用プレビューを開く

#### Redmine: Create Ticket from Editor

1. 説明文にしたい内容をエディタで開く
2. コマンド実行 → 件名を入力
3. 添付方法（ファイル/クリップボードの data URI）を選択
4. Mermaid ブロックは `{{mermaid ... }}` に変換されて投稿される

#### Redmine: Edit Comment

1. チケットを選び "Redmine Comments" で自分のコメントを選択
2. コメントが専用エディタに開く
3. 編集後にコマンド実行で内容を反映する

#### Redmine: Add Comment

1. "Redmine Tickets" でチケットを選択
2. コメント本文をエディタで開く（最大 20000 文字）
3. コマンド実行でアクティブエディタ内容を投稿する
4. 空白のみの入力はエラーで拒否される

## デバッグ実行

1. VS Code でこのリポジトリを開く
2. "Run Extension" を実行（F5）
3. Extension Host 側で設定を投入
4. 上記コマンドで動作確認

## テスト

- `pnpm test`: コンパイル + Lint + VS Code 統合テスト
- `pnpm run test:unsafe`: サンドボックス制限環境向けのテスト

## 既知の問題

- クリップボード添付は data URI 形式が必要

## リリースノート

### 0.0.1

Initial release.
