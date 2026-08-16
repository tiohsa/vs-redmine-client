# 同期ライフサイクル統合・非局所的整合性回復 変更計画書

日付: 2026-08-14
ステータス: 計画中
プロジェクトルート: `/home/glorydays/projects/src/ts/vs-redmine-client`

## 依頼内容

「同期ライフサイクル統合・非局所的整合性回復 変更仕様書」に基づき、個別不具合の局所パッチではなく、`SyncCoordinator` / `UnifiedSyncOperation` を唯一の production lifecycle owner とし、旧 `TicketSyncService` の独自ライフサイクル・二重 contract・secondary effect・recovery contract を完全に移行・撤去する。不変条件 INV-01 〜 INV-26 を担保し、テスト仕様 RT-01 〜 RT-09 を網羅する。

## 背景

HEAD `15c8b09` の調査により以下を確認：
1. **二重ライフサイクル**: `SyncEngine.syncOne` は Ticket/NewTicket で旧 `TicketSyncService` を呼び出し、Comment で `SyncCoordinator` を呼び出している。一方 `syncAll` は `SyncCoordinator` を呼んでいる。
2. **Attachment パイプラインのバイパス**: `createTicketFromEditor` が `TicketSyncService.syncEditor` を呼び、attachments を `as any` で渡している。新 `TicketCreateHandler` の secondary effects 実装に到達していない。
3. **Comment Update Recovery の検証漏れ**: `CommentUpdateHandler.reconcileRemote()` がチケット詳細取得成功のみで remoteId を返し、remote body の照合を行っていない。
4. **TicketUpdateHandler の機能欠落**: `assignee`, `unassign`, `done_ratio`, `estimated_hours`, `start_date`/`due_date` クリア、空文字 description、unknown metadata エラー、Child Saga 等が未完成。
5. **Secondary Remote Effects の Durable 化**: attachment upload, image upload 等が durable な開始・完了状態ジャーナルを通っていない。
6. **通知オーナーの重複**: `OutcomePresenter` と旧通知コントローラーの二重呼出の解消が必要。

## 調査結果

- `src/app/syncEngine.ts`: `syncOne` 内で `key.kind === "ticket"` の分岐で `TicketSyncService` を呼んでいる。
- `src/commands/createTicket.ts`: `TicketSyncService.syncEditor` を `uploads: attachments as any` で呼んでいる。
- `src/app/ticketSync/operationHandlers.ts`:
  - `TicketUpdateHandler` にメタデータ（担当者、工数、進捗率、クリア処理、空文字description等）の処理および Child Saga が欠落。
  - `CommentUpdateHandler.reconcileRemote` が body 検証を行わず無条件で成功を返している。
- `src/app/ticketSync/syncCoordinator.ts`: `commit_unknown` の自動再送禁止、phase-driven resume はあるが、`resolveCommitUnknown` の検証や secondary effect の永続化・状態管理を強化する必要がある。

## 判断

- **案D の採用**: 全ての同期ライフサイクルを `SyncCoordinator` に一本化し、旧ライフサイクルの所有権を撤去する。
- **Failure-First テスト先行**: 仕様書の指示に従い、まず RT-01 〜 RT-09 の不足テストを作成して失敗または振る舞いを固定してから実装を進める。
- **Handler の完全等価化**: `TicketUpdateHandler`, `TicketCreateHandler`, `CommentUpdateHandler`, `CommentCreateHandler` を旧実装および要求仕様と同等以上に実装する。
- **Comment Recovery の厳格化**: `CommentUpdateHandler.reconcileRemote` および `resolveCommitUnknown` において、remote body / author の照合を必須化し、未コミットの誤判定（false positive）を 0 にする。
- **Entry Point の統一**: `createTicketFromEditor`, `syncUnsyncedFile`, `performSyncOnSave`, `syncToRedmine`, `offlineSync` をすべて `SyncEngine` / `SyncCoordinator` 経由に統一する。

## 実装計画

1. **Phase 1: 回帰防止テスト (RT-01 〜 RT-09) の拡充・作成**
   - RT-01: `commentUpdateRecovery.test.ts` (Comment Update recovery correctness)
   - RT-02: `syncLifecycleOwnership.test.ts` (Ticket ownership: All entry points -> Coordinator)
   - RT-03: `syncAttachmentE2E.test.ts` (Production attachment E2E)
   - RT-04: `secondaryEffectRestart.test.ts` (Secondary effect restart & no blind retry)
   - RT-05: `ticketUpdateHandlerParity.test.ts` (Ticket metadata parity: assignee, clear dates, empty desc, etc.)
   - RT-06: `ticketChildSaga.test.ts` (Child Saga execution, timeout, compensation)
   - RT-07: `syncCoordinatorPhaseResume.test.ts` (Phase resume matrix)
   - RT-08: `syncConcurrency.test.ts` (CAS, single-flight, nextIntent promotion)
   - RT-09: `legacyQueueMigration.test.ts` (Migration of legacy queue)
2. **Phase 2: TicketUpdateHandler の Parity 完成**
   - assignee (name -> id, unassign), tracker, status, priority, dates (set/clear), done_ratio, estimated_hours, description `""`, unknown metadata handling, conflict check.
3. **Phase 3: Comment reconciliation contract 修正**
   - `CommentUpdateHandler.reconcileRemote` で ticketId, commentId, body を照合。
   - `resolveCommitUnknown` の `link_remote_comment` も厳密検証。
4. **Phase 4: Secondary effect durable journal 導入・強化**
   - attachment upload / image upload / child create の durable な状態管理と restart 後の blind retry 防止。
5. **Phase 5: TicketCreate attachment / Child Saga parity**
   - `TicketCreateHandler` に child ticket Saga (create, timeout, compensation) を統合。
6. **Phase 6 & 7: Ticket Create/Update / NewTicket を Coordinator へ本番移行**
   - `SyncEngine.syncOne` を `SyncCoordinator.sync` に一本化。
   - `createTicketFromEditor` を `TicketCreateIntent` / `SyncCoordinator` に直結。
7. **Phase 8: Comment lifecycle / recovery 最終統合**
8. **Phase 9: 全 Entry Point の統合**
   - `performSyncOnSave`, `syncUnsyncedFile`, `syncToRedmine`, `offlineSync` を同一の Coordinator 経路へ。
9. **Phase 10 & 11: 旧 TicketSyncService の独自ライフサイクル・payload/any の撤去**
10. **Phase 12 〜 15: 全テスト・リント・ビルド検証、ドキュメント更新、最終レビュー**

## リスクと対策

- リスク: 旧ライフサイクル撤去時に既存の 908 件のテストが破損するリスク。
  - 対策: `TicketSyncService` の公開メソッド（`syncEditor`, `syncQueueItem`, `syncAll` 等）を `SyncCoordinator` への委譲ラッパーとして維持し、動作セマンティクスを完全に新アーキテクチャに集約する。
- リスク: メタデータ解決や子チケット作成でのエッジケース。
  - 対策: RT-05, RT-06 で全フィールド・障害系（タイムアウト、補償トランザクション）を網羅的にテスト。

## 検証方法

- `pnpm run compile-tests`
- `pnpm run lint`
- `pnpm run compile`
- `pnpm test` (全テストパスの確認)

## 結果

実装待ち。
