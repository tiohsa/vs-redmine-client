# TicketSyncService 再設計仕様の完了監査

日付: 2026-08-10
ステータス: 完了
プロジェクトルート: `/home/glorydays/projects/src/ts/vs-redmine-client`

## 依頼内容

`origin/fix-20260810` の最新実コードを正として、ticket sync の副作用と local finalization を `TicketSyncService` に集約する新仕様を実装・検証する。既存実装を要件別に再監査し、実同期入口を通る idempotency、reconciliation、canonical state、connection scope、parity テストと全ローカルゲートを満たす。

## 背景

`origin/fix-20260810` は `e510c1d`、現在の `codex/ticket-sync-service` は同commit直上の `f5a5507` である。既存commitには `src/app/ticketSync/`、durable phase、reconciler、command移行、failure injection testsが含まれるが、今回の詳細仕様は application API とentry-point testの責務境界をさらに明確にしている。

## 調査結果

- 対象branch baselineは `pnpm install --frozen-lockfile`、lint、`tsc --noEmit`、compile-tests、compileが成功した。
- 対象branchの `pnpm test` は 759 passing / 3 failing。2件は `applyEditorContent()` がtest editorの `positionAt()` を前提にした失敗、1件はその連鎖でdraft statusが `Failed` になる失敗だった。
- 現実装の `syncAll()` は `newTickets` / `tickets` のsnapshotをcommandから受け取るため、queue enumeration ownershipがapplication serviceに完全移管されていない。
- 現実装の `syncQueueItem()` は `UnsyncedFileSyncKey` ではなくqueue operation本体を受け取り、`syncUnsyncedFile` がqueue lookupとremote-committed後のstatus mutationを行う。
- `TicketSyncService` は direct editor updateを一度queue intent化して同じ `applyQueuedTicketUpdate()` / `TicketReconciler` へ流しており、主要update/reconcile pipelineは共通化済み。
- parity testはtable-drivenだが、共通postconditionのうちregistry、Markdown control fields、remote side-effect回数の検証が不足している。
- `editor.edit=false` と `document.save=false` の低レベル検証はあるが、durable operationを通して `completed` にならず `createdIssueId` が残るapplication-level証明が不足している。

## 判断

- `syncQueueItem(key, context)` がservice内で明示scopeのqueueを解決する形へ変更し、adapterからoperation stateを排除する。
- `syncAll(context)` が同scopeのticket/new-ticket keyをsnapshotし、`syncQueueItem()` を逐次呼ぶ。progress/cancellationはoptional callbackで維持する。
- commentsは今回の `TicketSyncService` 対象外であり、既存comment pipelineを維持する。ticket/new-ticketのtransaction ownershipだけを移す。
- 既存portsとstate machineを活用し、generic frameworkや新DBは導入しない。

## 実装計画

1. key-based `syncQueueItem()` とcontext-owned `syncAll()` の期待APIをテストで固定し、現コードでRedを確認する。
2. service内のqueue key resolutionと `SyncAllOutcome` を実装し、Sync This File / Sync All adapterをpresentationだけへ縮小する。
3. editor edit/save failureをdefault document port経由で注入し、durable operation保持を確認する。
4. parity tableを実entryごとのadapterで構成し、side-effect回数、queue、draft、registry、control fields、canonical metadataを共通検証する。
5. legacy migration、connection scope、save concurrency、conflict、project metadata、child rollbackの既存testsを含む全ゲートを再実行する。

## リスクと対策

- リスク: key lookupへの変更でstale UI itemやlegacy `documentUri` なしentryが同期不能になる。
  対策: key kindごとの明示resolverとnot-found outcomeを追加し、legacy ticket ID lookupを維持する。
- リスク: Sync All cancellation時の集計順序が崩れる。
  対策: serviceが処理済みkeyとoutcomeを順序付きで返し、adapterはその結果だけを集計する。
- リスク: parity testのためにproduction専用の抽象化が増える。
  対策: 既存port injectionを利用し、必要な観測点だけを追加する。

## 検証方法

- `rtk pnpm install --frozen-lockfile`
- `rtk pnpm run lint`
- `rtk proxy pnpm exec tsc --noEmit`
- `rtk pnpm run compile-tests`
- `rtk pnpm run compile`
- `rtk pnpm test` または同等のno-sandbox Extension Host実行
- `rtk git diff --check`
- command/Dashboard内のticket transaction primitiveとapplication layerのimplicit scopeをsource auditする。

## 結果

- `syncQueueItem(key, context)` は明示scopeのstoreからoperationを解決し、adapterからqueue state操作を除去した。
- `syncAll(context)` は同scopeのqueue keyをsnapshotし、すべてのticket/new-ticketを `syncQueueItem()` で逐次同期する。
- `Sync This File` のrewrite失敗後に `Sync All` を実行するコマンド連鎖テストを追加し、`createIssue` が累計1回であることを確認した。
- `editor.edit() = false` / `document.save() = false` をapplication入口から注入し、`createdIssueId` と `local_finalize_pending` が残ることを確認した。
- table-driven parity testでremote side-effect回数、queue、draft、registry、Markdown control fields、canonical metadataを共通postconditionとした。
- 検証結果: lockfile install、lint、typecheck、compile-tests、compileはすべて成功。`pnpm test` は 789 passing / 0 failing。`git diff --check` も成功。
