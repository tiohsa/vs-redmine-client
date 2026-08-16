# 同期ライフサイクル統合 完成変更計画書

日付: 2026-08-14
ステータス: 計画中
プロジェクトルート: `/home/glorydays/projects/src/ts/vs-redmine-client`

## 依頼内容

`fix-bugs` 同期ライフサイクル統合 完成変更仕様書に基づき、新設した `SyncOperation`, Generic State Machine, `SyncOperationRepository`, `SyncCoordinator`, Operation Handlers, `OutcomePresenter` を、実際の production sync lifecycle の唯一の実装へと完成させ、旧ライフサイクルの所有者（`TicketSyncService` の独自ライフサイクル、`SyncEngine` の Comment 独自ライフサイクル、旧 `transitionOffline*Lifecycle*` 等）を完全撤去・集約する。

## 背景

現在、汎用ステートマシンや CAS リポジトリ、`SyncCoordinator` などの基盤は導入されたが、以下の問題点が残存している：
1. `createTicketFromEditor` で添付ファイル情報が旧 Service 経由で渡され、`effects` に `any` で混入しており新 Handler Saga パイプラインに統合されていない。
2. `TicketSyncService`, `SyncEngine` (Comment), `SyncCoordinator` の 3 系統のライフサイクル所有者が併存している。
3. `intentRevision` と CAS `version` が legacy `revision` への round-trip により再結合している。
4. `SyncCoordinator` が phase-driven resume になっておらず、中断フェーズからの再開ができない。
5. `TicketUpdateHandler` が metadata の更新を Redmine API に渡しておらず、旧実装と非等価（metadata 欠落リスク）。
6. `OutcomePresenter` と `NotificationController` の双方で `show*` が実行され、二重通知構造になっている。

## 調査結果

- **添付ファイルパイプライン**: `TicketCreateHandler.executeSecondaryEffects` にファイル・クリップボード画像のアップロード処理が存在するが、`createTicketFromEditor` が旧 `syncEditor` を呼んでいるため到達していない。
- **TicketUpdateHandler の契約**: 旧 `applyQueuedTicketUpdate` では `resolveMetadataUpdates`, `detectTicketUpdatedAtConflict`, `createQueuedChildTickets`, `rewriteDocumentWithRegisteredFields`, `updateDraftAfterSave` を行っているが、新 `TicketUpdateHandler` では `subject` と `description` の PUT しか行われていない。
- **Coordinator の resume**: `SyncCoordinator.sync()` は一律 `begin_preparation` から実行を開始するため、`remote_committed` や `local_finalize_pending` からの再開が二重 mutation やエラーになる。
- **CAS / 世代管理**: `syncRepository.ts` が `OfflineTicketUpdate.revision` に CAS version を書き戻しているため、次回 load 時に `intentRevision` が意図せず増加する。
- **通知所有権**: `OutcomePresenter` が `notifications.notifyTicketSaveResult` を呼んだ上で自ら `showWarning`/`showError` を呼んでいるため二重ポップアップになる。

## 判断

- **判断 1 (案 D 採用)**: 個別パッチではなく、同期ライフサイクル全体を `SyncCoordinator` に一本化する。
- **判断 2 (Handler Parity)**: `TicketUpdateHandler`, `TicketCreateHandler`, `CommentUpdateHandler`, `CommentCreateHandler` に旧実装の全機能（メタデータ、コンフリクト検出、child ticket Saga/compensation、添付アップロード、canonical read-back、local rewrite）を完全に移植・等価化する。
- **判断 3 (Phase-driven Coordinator)**: `SyncCoordinator` を operation の現在の phase に応じて再開可能なステート駆動型オーケストレーターに改修する。
- **判断 4 (永続化モデルの完全分離)**: `intentRevision`（ユーザー編集世代）と `version`（CAS 永続化世代）を真に分離し、ライフサイクル状態遷移で `intentRevision` が変化しないようにする。
- **判断 5 (単一通知オーナー)**: `OutcomePresenter` を通知の唯一の所有者とし、二重通知を解消する。

## 実装計画

### Phase 1: 回帰防止テスト (RT-A 〜 RT-F) の追加
1. `src/test/syncAttachmentE2E.test.ts` (RT-A): 添付ファイル E2E パイプライン検証
2. `src/test/syncLifecycleOwnership.test.ts` (RT-B): production Entry Point が Coordinator を唯一のライフサイクル所有者とすることの検証
3. `src/test/ticketUpdateHandlerParity.test.ts` (RT-C): TicketUpdateHandler のメタデータ・コンフリクト・子チケット完全反映検証
4. `src/test/syncCoordinatorPhaseResume.test.ts` (RT-D): Coordinator の全フェーズからの安全な再開マトリクス検証
5. `src/test/syncVersionSeparation.test.ts` (RT-E): `intentRevision` と CAS `version` の完全分離検証
6. `src/test/outcomePresenterSingleOwner.test.ts` (RT-F): 通知が 1 回のみ行われることの検証

### Phase 2: Handler Parity の完成
1. `TicketUpdateHandler`: `resolveMetadataUpdates`, `detectTicketUpdatedAtConflict`, `createQueuedChildTickets`, `rewriteDocumentWithRegisteredFields`, `updateDraftAfterSave` を統合。
2. `TicketCreateHandler`: 添付ファイルアップロード、child ticket Saga、same-document rewrite、`markNewTicketDraftSynced` を完全統合。
3. `CommentCreateHandler` / `CommentUpdateHandler`: `applyQueuedCommentUpdate`, `finalizeNewCommentDraftDocument`, `reconcileCommentCommitUnknown`, `updateCommentUpdateFileAfterSync` との等価性を確保。

### Phase 3: CAS Version と IntentRevision の永続化分離
1. `UnifiedSyncOperation` および `OfflineTicketUpdate`, `OfflineNewTicket`, `OfflineCommentUpdate` で `intentRevision` と `version`（`persistenceVersion`）を独立管理。
2. 状態遷移では `version` のみインクリメントし、Intent 更新時のみ `intentRevision` をインクリメント。

### Phase 4: Phase-Driven SyncCoordinator の実装
1. `SyncCoordinator.sync()` を現在の `phase` に応じた switch-case 分岐で適切なステップから再開可能にする。
2. `remote_committed`, `reconciliation_pending`, `local_finalize_pending` からの安全な resume。
3. `commit_unknown` の通常 sync からの自動再送禁止・明示的 reconciliation 専用化。

### Phase 5: Entry Point の完全移行と旧ライフサイクルの撤去・集約
1. `createTicketFromEditor`: `SyncCoordinator` への Intent 投入と実行に直接接続。
2. `performSyncOnSave` (`saveSyncExecutor.ts`): `SyncCoordinator` に一本化。
3. `syncEditorToRedmine` (`syncToRedmine.ts`), `offlineSync.ts`: `SyncCoordinator` に一本化。
4. `SyncEngine` および `TicketSyncService`: 内部実装を `SyncCoordinator` への委譲に集約。

### Phase 6: OutcomePresenter の通知一本化
1. `OutcomePresenter` 内での二重通知（`notifications` + `show*`）を解消し、単一の通知ポートで実行。

### Phase 7: 全体検証とドキュメント更新
1. `pnpm run compile-tests && pnpm run lint`
2. `pnpm test` (全テスト通過の確認)
3. `docs/implementation-decisions/2026-08-14-sync-lifecycle-unification.md` および `AGENTS.md` の更新。

## リスクと対策

- リスク 1: 旧ライフサイクル撤去時に既存の 900 件のテストケースで想定外の破壊が発生する。
  - 対策: `TicketSyncService` と `SyncEngine` の公開インターフェースは維持し、内部を `SyncCoordinator` への委譲に置き換えることで、既存テストとの互換性を保ちながらライフサイクル所有者を 1 つにする。
- リスク 2: `TicketUpdateHandler` でのメタデータ更新の欠落。
  - 対策: 旧 `applyQueuedTicketUpdate` で使用されていた `resolveMetadataUpdates`, `detectTicketUpdatedAtConflict`, `createQueuedChildTickets` を直接 Handler に組み込み、RT-C で全フィールドを検証する。

## 検証方法

- `pnpm run compile-tests` (TypeScript 型チェック)
- `pnpm run lint` (ESLint)
- `pnpm run compile` (Webpack バンドル)
- `pnpm test` (Extension Host テスト全件パス)

## 結果

実装待ち。
