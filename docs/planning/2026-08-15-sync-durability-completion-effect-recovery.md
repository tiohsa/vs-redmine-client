# 実装計画: Completion Durability / Effect Recovery / Compensation Certainty

**日付**: 2026-08-15  
**対象ブランチ**: `fix-bugs`  
**対象HEAD**: `fca6320b874e685745e0e06b3f9afb128bd33103`  

## 1. 根本原因の分析

### RC-A: Completion durability

- `completeOfflineNewTicketAsync` / `completeOfflineTicketUpdateAsync` / `completeOfflineCommentAsync` がmemory-first（queue変更 → persistAsync）
- `completeOperation()` が `saveOperation()` と同じmutex（`mutexByScope`）を経由しない
- Coordinator末尾（L450-454）に無条件 `completed` フォールバックがある
- Reconciliation checkpoint失敗（transitionOperation → undefined）でも処理が継続しcompletedに到達できる（L407-409）

### RC-B: Secondary Effect lifecycle

- `abort_before_remote_write` が `effects = []` で committed effectも消去（syncStateMachine.ts L141）
- Effect-specific recovery APIが存在しない（effectId単位でのresolveが不可能）
- attachment/image `commit_unknown` がnormal syncから自動再送される可能性
- child recovery時にPrimary PUT（updateIssue）を再送する可能性

### RC-C: Compensation / Primary Certainty

- `complete_compensation`成功後の `createdRemoteId = undefined` がローカルオブジェクト変更のみ（operationHandlers.ts L734）、Repository writeに含まれない
- `compensated` 状態でも `createdRemoteId > 0` でcommitted判定できてしまう（syncCoordinator.ts L116）
- compensation前後のcheckpoint失敗を `try{} catch{//ignore}` で握りつぶし

## 2. 修正ファイル一覧

| ファイル | 修正内容 |
|---------|---------|
| `src/app/ticketSync/syncStateMachine.ts` | `retainDurableEffectsForRetry`共通関数追加、abort時durable effect保持 |
| `src/app/ticketSync/syncRepository.ts` | `runExclusive`mutex, `completeOperation`mutex統合, compensation + `createdRemoteId` atomic化 |
| `src/app/ticketSync/syncCoordinator.ts` | Coordinator末尾fallback除去, reconciliation fail-closed, compensated Primary certainty修正, `resolveEffect`追加 |
| `src/app/ticketSync/operationHandlers.ts` | compensation checkpoint fail-closed, `operation.createdRemoteId=undefined`削除 |
| `src/views/offlineSyncStore.ts` | `completeOffline*Async` persist-first化 |
| `src/test/syncLifecycleIntegrationT01toT12.test.ts` | T-21分割(A〜D), T-25〜T-33追加 |
| `docs/implementation-decisions/` | 新実装判断ログ追加 |

## 3. 実装順序

1. T-25〜T-33をfailure-firstで追加 + T-21をA〜Dへ分割
2. Coordinator末尾false-completed経路を閉じる
3. Reconciliation checkpointをfail-closed化
4. Completion用共通mutex laneを導入
5. Completionをpersist-first化
6. Completion CAS/nextIntent処理をmutex内へ移動
7. abort時のdurable Secondary Effect保持（retainDurableEffectsForRetry）
8. Effect-specific recovery API導入（resolveEffect）
9. attachment/image effect recovery
10. child effect recovery
11. Compensationと`createdRemoteId`をatomic化
12. compensated Primary certainty判定修正
13. compensation checkpoint fail-closed化
14. legacy lifecycle owner整理
15. lint / TypeScript compile / webpack compile
16. implementation decision log更新

## 4. 新規不変条件

| ID | 内容 |
|----|------|
| INV-N08 | 同一scopeのpersistent lifecycle writeは同一serialization laneを通る |
| INV-N09 | Persistent completionが成功するまでmemoryからoperationを削除・昇格しない |
| INV-N10 | Reconciliation→Finalize間のdurable checkpointが失敗した場合、`completed`を返さない |
| INV-N11 | Committed Secondary Effectは、Primary未commitのretry rollbackでも失われない |
| INV-N12 | Primary compensation成功は `primary=compensated, createdRemoteId=undefined` をatomicに成立させる |
| INV-N13 | Secondary Effect recoveryはPrimary mutationから独立して実行できる |
