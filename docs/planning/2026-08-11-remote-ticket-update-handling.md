# サーバ側チケット更新の検知と安全な再読込

日付: 2026-08-11
ステータス: 実装済み
プロジェクトルート: `/home/glorydays/projects/src/ts/vs-redmine-client`

## 依頼内容

Redmine サーバ側で更新されたチケットを拡張機能側で扱うための修正案を検討する。既存の手動再読込と保存時競合検知を踏まえ、ローカル編集を失わない同期方針を定める。

## 背景

`redmine-client.reloadTicket` と `redmine-client.reloadComment` は、編集中の対象を `getIssueDetail` で取得し、`applyEditorContent` でエディターの本文を置き換える。ダッシュボードの `redmine-client.refreshTickets` は一覧を再取得する。Redmine REST API を定期的に問い合わせる処理や、更新通知を受け取る仕組みはない。

チケット保存時は `lastKnownRemoteUpdatedAt` とサーバから取得した `updatedAt` を比較し、差異があれば `conflict` を返す。コメントにも同等の変更検知がある。したがって上書き保存は防げる一方、再読込では未保存のローカル下書きが失われうる。

## 調査結果

- `src/commands/reloadTicket.ts` は、対象エディターと接続スコープを検証した後、`reloadTicketEditor` を直接実行する。再読込前の変更確認はない。
- `src/views/ticketSync/ticketUpdateSync.ts` の `reloadTicketEditor` は常に取得結果をエディターへ適用し、`updateDraftAfterSave` によりローカル下書きを消去する。
- `src/views/commentSaveSync.ts` の `reloadCommentEditor` も同様に本文を常に置換し、コメント下書きを消去する。
- `src/views/ticketSync/ticketUpdateSync.ts` の保存処理は、サーバの `updatedAt` が `lastKnownRemoteUpdatedAt` と異なる場合に競合として保存を停止する。
- 既存テストは、チケット・コメントの再読込が下書きをサーバ内容で上書きすることを明示的に検証している（`src/test/ticketSaveSync.test.ts`、`src/test/commentSaveSync.test.ts`）。

## 判断

- 第1段階では、手動再読込を安全化する。ローカル内容が基準（最後に同期した内容）から変更されている場合、サーバ内容の適用前に確認を求め、既定操作はキャンセルとする。ローカル編集がない場合は従来どおり即時再読込する。
- 下書きの有無は `TextDocument.isDirty` だけでは判定しない。untitled 文書、保存済みのローカル下書き、拡張機能による本文書換えを正しく扱うため、チケットは `TicketDraft` の base/draft 値、コメントは `CommentEdit` の base/draft 値と現在のエディター内容を比較する純粋関数で判定する。
- 第2段階として、ダッシュボード表示時・明示的な更新時に一覧を再取得する現行動作を維持する。常時ポーリングは、リクエスト量・複数接続スコープ・バックグラウンドでの通知 UX を別途設計できるまで導入しない。
- Redmine の一般的な REST API はサーバから拡張機能へのプッシュ通知を提供しないため、自動検知を行う場合はクライアント側ポーリングが必要になる。初期導入でそれを必須にすると設定・レート制御・エラー通知の責務が増える。

## 実装計画

1. チケットとコメントについて「ローカル下書きあり」を判定するテスト可能な関数を追加する。基準内容と現在の本文が同一なら安全、異なるなら確認対象とする。
2. `reloadTicketFromEditor` と `reloadCommentFromEditor` のコマンド層で判定し、未保存変更があれば `showWarningMessage` に「再読込してローカル変更を破棄」と「キャンセル」を提示する。破棄を明示選択したときだけ既存の reload 関数を呼び出す。
3. チケット・コメントのコマンドテスト、および既存の再読込ユニットテストを更新する。ローカル変更なしの即時再読込、変更ありのキャンセル、変更ありの明示破棄を確認する。
4. 将来の自動検知が必要になった場合は、接続スコープごとに単一タイマーを持つポーリングサービスを追加し、開いている編集対象では `updatedAt` 差異を通知・競合状態化するだけに留める。自動上書きはしない。

## リスクと対策

- リスク: 再読込時の確認が頻繁に表示され、単なる最新化が煩雑になる。
  対策: 最後に同期した内容と現在の内容が同じ場合は確認を表示しない。既定ボタンをキャンセルにする。
- リスク: ローカル編集の判定が本文以外のメタデータ変更を見落とす。
  対策: チケットは subject、description、metadata を既存パーサーで比較し、コメントは本文を比較する。空白正規化の規則は保存処理と合わせる。
- リスク: 自動ポーリングが Redmine への負荷や不要な通知を増やす。
  対策: 今回は導入しない。導入時は設定可能な間隔、ウィンドウ可視時のみの実行、接続失敗の抑制を設計・テストする。

## 検証方法

- `pnpm test -- --grep "reload"` または対応するテストファイルを実行し、チケット・コメントの確認分岐を検証する。
- `pnpm run lint`
- `pnpm run compile`
- VS Code 上で、ローカル編集なし・ローカル編集ありでの Reload Ticket / Reload Comment を手動確認する。

## 結果

チケット・コメントの手動再読込前に、同期済み基準値と現在のエディター内容を比較する保護を追加した。ローカル変更がある場合は明示的な破棄選択がなければ再読込しない。`pnpm run compile`、`pnpm run lint`、`pnpm test -- --grep "Reload safety"`（サンドボックス外、834件）を通過した。サーバ更新の自動検知は、設定と負荷制御を含む後続機能とする。
