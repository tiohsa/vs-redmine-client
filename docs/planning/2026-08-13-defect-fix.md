# 同期アーキテクチャの不具合検出と修正

日付: 2026-08-13
ステータス: 実装済み
プロジェクトルート: `/home/glorydays/projects/src/ts/vs-redmine-client`

## 依頼内容

プロジェクト全体を対象に、チケット・コメント同期を中心とした不具合を検出し、局所的な回避ではなく同期ライフサイクル全体の設計に沿って修正する。変更箇所には回帰テストを追加し、既存の品質ゲートで検証する。

## 背景

現在の実装は `src/app/syncEngine.ts` を共通入口、`src/app/ticketSync/` と `src/views/commentSaveSync.ts` をドメイン別処理、`src/views/offlineSyncStore.ts` を接続スコープ別の永続キューとして構成している。remote write 前後の phase、revision fence、commit unknown、local document finalize、child compensation が導入されているため、単一関数ではなく状態遷移と全 entry point の整合性を確認する必要がある。

## 調査結果

- CodeGraph は 617 ファイル、約 4 万ノード、約 7 万エッジを正常に索引化している。
- `origin/codex/ticket-sync-service...HEAD` は同期ライフサイクル統合を中心とした大規模差分で、`syncEngine`、`ticketSyncService`、`offlineSyncStore`、競合解決、コメント同期に変更が集中している。
- `pnpm run compile` と `pnpm run lint` は現時点で成功している。機能不具合は型検査だけでは検出できないため、状態遷移テストと call site の確認を継続する。
- 過去のレビュー記録では、remote commit 後の後続編集、remote POST と永続 journal の分散トランザクション、no-change の canonical refresh が重要なリスクとして扱われ、その後の差分で対策された形跡がある。現行実装で再発していないかを確認する。

## 判断

- `commit_unknown`、`remote_committed`、`local_finalize_pending`、`nextIntent` の境界を優先して確認する。ここでデータ消失や重複 POST が起きると、部分的な UI 修正では解決できない。
- 修正は共通の `SyncEngine` / `offlineSyncStore` / reconciler の責務境界に置き、個別コマンドだけに分岐を追加しない。
- 既存のユーザー変更（未追跡の `docs/` を含む）は巻き戻さず、今回の計画・実装ファイルだけを追加・更新する。

## 実装計画

1. ブランチ差分、同期状態遷移、主要 call site、既存テストを確認して再現可能な不具合を特定する。
2. 根本原因に対応する共通状態遷移またはサービス境界を修正し、対象シナリオの回帰テストを追加する。
3. `compile-tests`、`compile`、`lint`、`test` を実行し、未実行の検証と残存リスクを記録する。

## リスクと対策

- リスク: 永続化の更新順序や revision fence を壊すと、再起動時に queue 欠落・二重送信が起こる。
  対策: 既存の async transition API を通し、operation revision と phase の期待値をテストで固定する。
- リスク: remote write 後のローカル文書更新がユーザー編集を上書きする。
  対策: document version / payload revision / next intent の扱いを reconciler と finalizer の両方で確認する。
- リスク: 現実の Redmine API の応答不確定性をローカルテストだけで見落とす。
  対策: remote mutation の mock で成功、既知失敗、結果不明、journal 失敗を分けて検証する。

## 検証方法

- `pnpm run compile-tests`
- `pnpm run compile`
- `pnpm run lint`
- `pnpm test`
- `git diff --check`
- 差分に対応する状態遷移・同期入口・再起動復旧テスト

## 結果

`offlineSyncStore` の再起動正規化で、`newTicket` と新規コメントの durable effect が `started` / `commit_unknown` の場合に `queued` へ戻さず `commit_unknown` として保持するよう修正した。これにより remote POST の結果記録前にプロセスが終了しても、次回起動時の自動再 POST を防止する。両ケースの回帰テストを追加した。

検証済み: `pnpm run compile-tests`、`pnpm run compile`、`pnpm run lint`、`pnpm run test:unsafe`（882 passing）、`git diff --check`。
