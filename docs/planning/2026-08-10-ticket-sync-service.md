# TicketSyncService と durable sync lifecycle の導入

日付: 2026-08-10
ステータス: 完了
プロジェクトルート: `/home/glorydays/projects/src/ts/vs-redmine-client`

## 依頼内容

添付仕様に従い、Redmine への remote commit とローカル finalization を単一の同期ユースケースへ集約する。新規チケットの重複作成防止、post-write read-back の再開可能化、direct/queued 経路の canonical state 統一、明示的 connection scope、永続化 barrier、回帰テストを実装する。

## 背景

現行実装では `src/commands/syncToRedmine.ts`、`src/commands/syncUnsyncedFile.ts`、`src/commands/offlineSync.ts`、`src/dashboard/services/DashboardComposerService.ts` が remote API、queue、registry、draft、document rewrite を個別に組み合わせている。`src/views/ticketSync/` には create/update/queue の処理があるが、同期完了条件は共通化されていない。

## 調査結果

- `syncUnsyncedFile` は `OfflineNewTicket.createdIssueId` があれば POST を省略するが、`runOfflineSync` は全 new ticket で `createTicketFromQueuedContent()` を呼ぶ。
- `offlineSyncStore.persist()` は `Memento.update()` を fire-and-forget し、remote create 後の durability barrier を提供しない。
- `syncNewTicketDraft` は remote create 後に queue/journal へ `createdIssueId` を保存せず、draft/registry を document rewrite より先に更新する。
- `getCreatedTicketDetail()`、direct update、queued update は post-write GET failure を握りつぶし、旧 revision または local content を synced baseline とする。
- `OfflineTicketUpdate` は `documentUri` を持たず、queued sync 後に source Markdown を canonical state へ戻せない。
- `applyEditorContent()` は `editor.edit()` の boolean を確認せず、`rewriteNewTicketEditorToTicketMode()` は `document.save()` の boolean を確認しない。
- connection scope の snapshot と per-URI save serialization、legacy editor fail-closed は既存実装にあり、維持対象である。
- CodeGraph は未初期化だったため、ユーザーへ初期化可否を確認しつつ、既知ファイルを読み取り専用で調査した。

## 判断

- application service を `src/app/ticketSync/` に追加し、まず ticket create/update と queue item の lifecycle ownership を移す。既存 UI 戻り値は adapter で `TicketSaveResult` に変換して互換性を維持する。
- durable operation の保存先は既存 `OfflineSyncQueue` を additive に拡張する。別の Memento key を追加すると既存 queue と lifecycle が二重化するため、現行 queue を SyncJournal port として扱う。
- queue mutation API に await 可能な variant を追加し、remote commit barrier と完了処理でのみ使用する。既存同期 API は互換性のため残す。
- existing update は `reconciliation_pending` を queue entry に保持し、retry は PUT を省略して GET と local finalize のみ実行する。

## 実装計画

1. `OfflineNewTicket` / `OfflineTicketUpdate` を additive に拡張し、await 可能な persistence API と legacy phase 正規化を追加する。
2. `ticketSyncOutcome.ts`、`ports.ts`、`newTicketFinalizer.ts`、`ticketReconciler.ts`、`ticketSyncService.ts` を追加する。
3. new ticket の `createOrResume` を実装し、remote create 後に `createdIssueId` を永続化してから GET/rewrite/save/registry/draft/queue 完了へ進める。
4. existing update の direct/queued reconciliation を共通化し、post-write GET failure と retry を状態として保持する。
5. `syncToRedmine`、`syncUnsyncedFile`、`offlineSync`、Dashboard を service adapter へ移し、Sync All は item 単位の同じユースケースを順次呼ぶ。
6. failure injection、restart、entry-point parity、connection scope、canonical state の回帰テストを追加する。
7. `pnpm test`、`pnpm run lint`、TypeScript typecheck、`pnpm run compile` を実行する。

## リスクと対策

- リスク: remote side effect 後の例外で lifecycle state が失われる。
  対策: `createdIssueId` / committed phase の Memento 更新を await し、成功前に次工程へ進まない。
- リスク: 既存 queue schema と保存済み Markdown を破壊する。
  対策: optional field のみ追加し、field 欠落を legacy `queued` と解釈する。
- リスク: command/UI の表示や戻り値互換性が崩れる。
  対策: application outcome と既存 `TicketSaveResult` を分離し、adapter で変換する。
- リスク: child ticket の複数 remote side effect が完全には journal 化されない。
  対策: operation record に `createdChildIds` を保持可能な形にし、既存 rollback を維持する。

## 検証方法

- `rtk pnpm run compile-tests`
- `rtk pnpm run lint`
- `rtk pnpm run compile`
- `rtk pnpm test`
- failure injection テストで create/update の call count、phase、queue 保持、canonical draft/Markdown を検証する。

## 結果

`src/app/ticketSync/` に同期ユースケースと outcome/port/finalizer/reconciler を追加し、ticket create/update の production entry point を `TicketSyncService` へ集約した。remote commit 後は operation phase と remote ID/revision を await 可能な barrier で保存し、GET read-back、canonical Markdown、draft/registry、queue 完了を再開可能な local finalization として扱う。

新規チケットは `createdIssueId` が journal に存在する限り POST を再実行せず、既存チケットは PUT 後の GET 失敗を `reconciliation_pending` として保持して retry 時に PUT を省略する。`OfflineTicketUpdate.documentUri`、connection scope、operation identity、legacy migration、URI identity normalization、per-scope persistence serialization を追加した。editor edit/save の boolean failure も同期失敗として扱う。

command、Dashboard、Sync One、Sync All は共通 service を呼ぶ構成となり、Sync All の item loop 自体も `TicketSyncService.syncAll()` が所有する。entry-point parity、restart、failure injection、single-flight、scope、serialization、legacy editor、local-finalize 順序の回帰テストを追加した。

検証結果:

- `rtk pnpm run test:unsafe`: 786 passing、終了コード 0（compile-tests、webpack、lint を含む）
- `rtk proxy pnpm exec tsc --noEmit`: 成功
- `rtk pnpm run lint`: 成功（既存の `.eslintignore` 非推奨警告のみ）
- `rtk pnpm run compile`: 成功
- `rtk git diff --check`: 成功

GitHub Actions は `main` の直近5件が green であることを読み取り確認した。一方、実装は未コミットのローカル差分であり、`fix-20260810` に workflow run は存在しないため、この差分自身の CI green は未証明である。
