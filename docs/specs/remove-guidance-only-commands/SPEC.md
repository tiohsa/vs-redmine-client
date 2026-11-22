# SPEC: 案内のみを表示するコマンドを削除する

## 1. 目的

実際の操作を行わず Dashboard の操作方法を案内するだけのコマンドを削除し、実際に使える Dashboard の操作とコマンドを維持する。

## 2. 対象外

- Dashboard の機能、操作方法、Webview メッセージ、選択状態や永続化の変更。
- 削除する ID の互換コマンド、移行処理、既存キーバインドの移行。
- 実際にコメントを追加する `redmine-client.addCommentFromComments` と、プロジェクトをブラウザで開く `redmine-client.openProjectInBrowser` の削除。

## 3. 受け入れ条件

- [ ] 以下の `redmine-client.` プレフィックス付き ID はマニフェストに存在せず、拡張機能の有効化後に `vscode.commands.getCommands` からも取得されない。`addComment`、`loadMoreTickets`、`toggleRelevantTickets`、`configureTicketTitleFilter`、`configureTicketPriorityFilter`、`configureTicketStatusFilter`、`configureTicketTrackerFilter`、`configureTicketAssigneeFilter`、`configureTicketSort`、`configureTicketDueDateDisplay`、`resetTicketListSettings`。
- [ ] 日本語と英語のコマンドパレットには削除対象の `addComment` に対応する重複項目が表示されない。同じ表示名を持つ実用コマンド `addCommentFromComments` は引き続き表示され、選択中のチケットにコメントを追加できる。
- [ ] Dashboard のコメント追加、追加読み込み、関連チケット切替、フィルター、並び替え、期日表示と一覧設定のリセットは引き続き利用できる。
- [ ] `openProjectInBrowser` は選択中のプロジェクトを開き、選択がない場合は既存の案内を表示する。

## 4. 公開 API・DB スキーマ

- 上記のコマンド ID は公開登録から削除し、互換登録を設けない。`addCommentFromComments` と `openProjectInBrowser` は維持する。
- Redmine API、Webview メッセージ、永続化スキーマに変更はない。

## 5. 制約

- Webview の入力検証、接続先の分離、認証情報の保護、同期と永続化の既存の境界を維持する。
- コメントと Dashboard の正本仕様、README、検証マップを実装に合わせて更新する。性能要件の変更はない。

## 6. 必須テスト

- **単体**　マニフェストに削除対象 ID が含まれないことと、日本語・英語のパレット表示で実用のコメント追加項目が残ることを検証する。
- **統合**　拡張機能の有効化後に `vscode.commands.getCommands` で削除対象 ID の不在を確認する。削除済み ID の登録を意図的に復元した場合に検証が失敗することを確認する。
- **回帰**　既存の Dashboard 操作とブラウザ起動のテストを実行し、選択済み・未選択のプロジェクトとコメント追加を確認する。`pnpm run verify:all` と `pnpm run test:dashboard-ui` を実行する。
