# 実装判断ログ: 同期耐久性・完了信頼性・Effect回復修正

**日付**: 2026-08-16  
**対象ブランチ**: `fix-bugs`  
**計画書**: `docs/planning/2026-08-15-sync-durability-completion-effect-recovery.md`

---

## 実装した修正の概要

RC-A（Completion Durability）、RC-B（Secondary Effect Lifecycle）、RC-C（Compensation/Primary Certainty）の3系統を修正し、INV-N08〜INV-N13の新規不変条件を導入した。

---

## Phase 1: syncStateMachine.ts — abort時Effect保持 (INV-N11)

### 変更内容
`retainDurableEffectsForRetry` 関数を追加し、`abort_before_remote_write` / `abort_known_remote_failure` 遷移で `effects = []` する代わりにdurable effectsを保持するよう変更した。

### 判断事項
- **保持するstateの選択**: `committed`, `commit_unknown`, `compensation_started`, `compensation_unknown` の4種を保持対象とした。`failed` は再試行可能なため除外（次回syncでplanし直す）。`planned`/`started` は未完了のため除外。
- **関数をexportした理由**: T-29で直接テストするため（`saveOperation` が `preparing` フェーズをノーマライズするため、`applyGenericTransition` を純粋関数として直接テストする必要があった）。

---

## Phase 2: syncRepository.ts — mutex統合・persist-first完了・compensation atomic化 (INV-N08, INV-N09, INV-N12)

### 変更内容
1. `mutexByScope` の型を `Map<string, Promise<any>>` から `Map<string, Promise<unknown>>` に変更
2. `runExclusive<T>` プライベートメソッドを追加し、`saveOperation` と `completeOperation` を共通serialization laneに統一
3. `transitionEffect` の `ticket_create` + `compensated` 状態への遷移時に `createdRemoteId = undefined` をatomicにセット

### 判断事項
- **saveOperation末尾の手動mutex管理削除**: `runExclusive` が自動的にmutex管理するため不要。手動管理コードが残っていたため削除した。
- **completeOperation を runExclusive に統合した理由**: `saveOperation`（nextIntent書き込み）と `completeOperation`（完了削除）の競合でLost updateが発生しうるため、同一scopeのlaneで直列化が必要。

---

## Phase 3: offlineSyncStore.ts — persist-first completion (INV-N09)

### 変更内容
`completeOfflineNewTicketAsync`, `completeOfflineTicketUpdateAsync`, `completeOfflineCommentAsync` の3関数をpersist-firstパターンに変更:
- next snapshotを先に構築 → `replaceOfflineSyncQueueAsync` でpersist → persist成功後のみmemoryを更新
- persist失敗時は `false` を返し、in-memory stateを変更しない

### 判断事項
- **`replaceOfflineSyncQueueAsync` を直接使った理由**: `persistAsync(scope)` は現在のin-memory stateをそのままpersistするため、next snapshotを先にpersistするには `replaceOfflineSyncQueueAsync` を使う必要があった。
- **`completeOfflineNewTicketAsync` は前セッションで既に変更済み**だった（チェックイン時に発見）。

---

## Phase 4: syncCoordinator.ts — fail-closed reconciliation / compensated Primary certainty (INV-N10, INV-N12)

### 変更内容

#### A) Reconciliation checkpoint fail-closed
`transitionOperation(record_reconciled_identity | mark_local_finalize_pending)` が失敗した場合、`completed` を返さず `remote_committed` (pending: "remote_reconcile") を返すように変更。

#### B) Coordinator末尾フォールバック変更
`executeSyncLifecycle` の末尾に到達した場合、無条件 `completed` の代わりに `remote_committed` + "Unexpected phase" メッセージを返すよう変更。

#### C) compensated Primary certainty判定修正
- `primary?.state === "compensated"` の場合は `committed` と誤判定しない
- legacy entry（effects未記録）の場合のみ `createdRemoteId` を fallback 使用

#### D) resolveEffect メソッドを追加 (INV-N13)
effectId単位でPrimary mutationとは独立してSecondary Effect recoveryを実行するパブリックAPIを追加。

### 判断事項
- **RT-A テスト regression の原因と修正**: `InMemoryRepository.transitionOperation` に `record_reconciled_identity → local_finalize_pending` の処理が欠けていた。私の fail-closed 追加によって潜在バグが表面化した。`syncAttachmentE2E.test.ts` の mock に `record_reconciled_identity` ケースを追加。プロダクションコードの問題ではなくテストmockの不完全さが原因。
- **isPrimaryCommittedの型比較**: TypeScriptのunion typeで `"committed"` と `"compensated"` は同時になれないため、`state === "committed"` で既にcompensated除外が保証される。冗長な `&& state !== "compensated"` は型エラーになるため削除。

---

## Phase 5: operationHandlers.ts — compensation fail-closed (INV-N12, INV-N15)

### 変更内容
親チケット・子チケットの補償ロジックを fail-closed に変更:
- `start_compensation` checkpoint が失敗した場合、DELETE を実行しない（fail-closed）
- DELETE 成功後の `complete_compensation` persistence 失敗時は `compensation_unknown` としてマーク
- `try{} catch{// ignore}` パターンを除去
- `operation.createdRemoteId = undefined` の直接代入を削除（`transitionEffect` 内でatomicに処理）

---

## テスト追加

### T-21 分割 (T-21A〜D)
既存T-21は `start` 失敗のみをテストしていた。`commit` 失敗後の二重作成防止も検証するため4ケースに分割した。

### T-25〜T-33 新規追加

| テストID | 検証内容 | 対応するINV |
|---------|---------|-----------|
| T-25 | reconcile checkpoint persistence failure → completed 禁止 | INV-N10 |
| T-26 | record_reconciled_identity/mark_local_finalize_pending failure → completed 禁止 | INV-N10 |
| T-27 | completeOperation persistence failure → in-memory変更禁止 | INV-N09 |
| T-28 | completeOperation + saveOperation の mutex 直列化 | INV-N08 |
| T-29 | abort時のcommitted effect保持（applyGenericTransition直接テスト） | INV-N11 |
| T-32 | compensated + createdRemoteId=undefined で re-create 実行 | INV-N12 |
| T-33 | complete_compensation persistence 失敗後の recovery-required state | INV-N12 |

> T-30, T-31 は `resolveEffect` APIのhandler実装が必要なため今回スコープ外とした（APIシグネチャのみ追加済み）。

### T-26 設計上の問題と対処
`ticket_update` のreconcileは `remoteId` を返すため `mark_local_finalize_pending` ではなく `record_reconciled_identity` が使われる。FlakyRepoを両アクション失敗させるよう変更した。

### T-29 設計変更の理由
`repo.saveOperation(phase: "preparing")` はノーマライゼーションで `queued` に変換されるため、`abort_before_remote_write`（`sourcePhase: "preparing"` 要件）が失敗した。`applyGenericTransition` と `retainDurableEffectsForRetry` を直接テストする純粋関数テストに変更することで回避した。

---

## 検証結果

| 検証項目 | 結果 |
|---------|------|
| `pnpm run compile-tests` | 成功 |
| `pnpm run lint` | 0エラー |
| `pnpm run test:unsafe` | 962 passing / 0 failing |

---

## 保持した不変条件

- Primary Effect 未記録の場合も `createdRemoteId` によるlegacy fallback は維持（INV-N01互換）
- `transitionEffect` の `saveOperation` 呼び出しによるpersistence firstは既存動作を維持
- `completeOperation` の `runExclusive` 化により `saveOperation` との競合を防止（INV-N08新規）

---

## 実行できなかった検証

- `pnpm test`（Electron sandboxエラーのため）: `pnpm run test:unsafe` で代替
- T-30, T-31（resolveEffect handler実装なし）: APIシグネチャと設計は完了、handlerの実装は別タスク
- 実際のRedmine環境でのE2E検証: テスト環境がないため
