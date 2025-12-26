# TodoEx

VS Code 上で Redmine 6.1 のチケット管理を完結できます。プロジェクト別のチケット一覧、
読み取り専用プレビュー、エディタ内容からのチケット作成、画像添付、
自分のコメント編集に対応します。

English README: `README.md`

## 主な機能

- サイドバーでチケット一覧（ステータス/担当者フィルタ）
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

- `todoex.baseUrl`: Redmine のベースURL
- `todoex.apiKey`: Redmine API キー
- `todoex.defaultProjectId`: デフォルトのプロジェクトID/識別子
- `todoex.includeChildProjects`: 子プロジェクトを一覧に含めるか
- `todoex.ticketListLimit`: 取得するチケット件数（デフォルト50）

## 使い方

1. `todoex.baseUrl` と `todoex.apiKey` を設定
2. `todoex.defaultProjectId` を設定（またはコマンドで選択）
3. サイドバーの "Redmine Tickets" で一覧を確認
4. チケット選択でプレビューとコメントを表示
5. "Redmine: Create Ticket from Editor" で新規作成
6. "Redmine: Edit Comment" で自分のコメントを編集

## コマンド

- `Redmine: Refresh Tickets`
- `Redmine: Select Project`
- `Redmine: Toggle Child Projects`
- `Redmine: Open Ticket Preview`
- `Redmine: Create Ticket from Editor`
- `Redmine: Edit Comment`

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
