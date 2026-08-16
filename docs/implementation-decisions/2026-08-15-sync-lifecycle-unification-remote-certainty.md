# 実装決定記録: 同期ライフサイクル統合・Remote Certainty / Durable Effect 修正

**日付**: 2026-08-15  
**対象ブランチ**: `fix-bugs`  
**対応仕様**: `docs/planning/2026-08-15-sync-lifecycle-unification-remote-certainty.md`  
**関連不変条件**: INV-U01 〜 INV-U16  
**関連設計決定**: DR-01 〜 DR-05  

---

## 1. 概要と背景

`fix-bugs` ブランチにおいて、同期処理に共通する以下の3つの根本原因（Root Causes）を完全に閉じるための共通改修を実施した。

1. **RC-1 (Primary Remote Commit と Secondary Effect の確定性混在)**: Secondary Effect（添付ファイル・画像アップロードなど）の成功・不確定状態によって Primary mutation（チケット・コメントの作成/更新）の Remote Certainty が誤判定されていた。
2. **RC-2 (Persistent State の変更・CAS・完了処理の durable 保証欠如)**: 永続化（Memento/queue）の書き込み失敗時にメモリだけが先行更新され、または Intent 昇格時に committed な effect が消去される不整合が存在した。
3. **RC-3 (Lifecycle / Restart normalization / State ownership の多重化)**: `TicketUpdateHandler` で child issue の作成が parent PUT の前に実行されていたため、親チケット更新失敗時に孤立子チケットが残る問題や、Repository をバイパスする経路が存在した。

---

## 2. 実施した設計決定とトレードオフ

### DR-01: Remote Certainty の唯一のソースを Primary Remote Commit に限定 (INV-U01, INV-U02, INV-U03)
- **決定**: `SyncCoordinator` において、`executeSecondaryEffects` 失敗時に `hasCommittedOrUnknownEffects` に基づいて Primary を `record_remote_commit` する誤ったロジックを撤去。Primary Mutation（チケット PUT/POST、コメント PUT/POST）が成功した場合のみ `record_remote_commit` へ進むように厳格化。
- **トレードオフ**: Secondary Effect 失敗時は即座に処理が中止（`failed_before_commit` または `commit_unknown`）されるが、中途半端な親チケット更新が防止される。

### DR-02: TicketUpdate child creation を Primary PUT の後へ移動 (INV-U04, INV-U05)
- **決定**: `TicketUpdateHandler.executeRemoteWrite` において、Primary PUT を先に実行し、成功後に Dependent Effects として child issue を作成する順序に変更。
- **効果**: 親チケットの更新がバリデーションエラー等で既知失敗（HTTP 400等）した場合に、子チケットが重複・孤立して作成される問題（T-02）を完全に排除。

### DR-03: Memento 永続化成功後の in-memory 反映 (アトミック化) (INV-U09, INV-U10)
- **決定**: `offlineSyncStore.ts` の `replaceOfflineSyncQueueAsync` において、先に `schedulePersist` を await し、Memento へのシリアライズ・書き込みが完了した後にのみメモリ上の `queue` マップを更新するように改修。
- **効果**: Memento の書き込みエラー時にメモリとストレージが乖離して restart 時にデータが消失する問題（P1-03, T-03）を解消。

### DR-04: Intent 昇格時の Durable Effects 保持 (INV-U11, INV-U12)
- **決定**: `promoteTicketIntent`, `promoteNewTicketIntent`, `promoteCommentIntent` において、既存の committed / commit_unknown / compensation_* な effect をクリアせず次リビジョンへ継承するように修正。
- **効果**: Intent 昇格時にアップロード済み画像や作成済み子チケットのトークン/ID が消失して重複作成される問題（P1-04, T-04）を解消。

### DR-05: SyncOperationRepository への mutex シリアライズと CAS フェンス強化 (INV-U06, INV-U13, INV-U15)
- **決定**: `DefaultSyncOperationRepository` に per-scope mutex を導入し、`saveOperation` をシリアライズして CAS チェック（`version` / `persistenceVersion`）をアトミックに検証。また `planEffect` / `transitionEffect` において `expectedRevision` との厳格なフェンスチェックを追加。

---

## 3. 検証結果

- **Failure-First 統合テスト (`src/test/syncLifecycleIntegrationT01toT12.test.ts`)**:
  - T-01: Secondary Effect 失敗時の Primary Remote Commit 誤判定防止 (PASS)
  - T-02: TicketUpdate Primary PUT 既知失敗時の child 作成抑止 (PASS)
  - T-03: Memento 永続化失敗時のメモリ queue 破壊防止 (PASS)
  - T-04: Intent 昇格時の durable effect 保持 (PASS)
  - T-05: planEffect / transitionEffect の revision fence (PASS)
  - T-06: restart normalization の Phase & Effects 整合性 (PASS)
  - T-07: commit_unknown からの reconciliation 冪等性 (PASS)
  - T-08: 連続 Intent 昇格時の revision 単調増加 (PASS)
  - T-09: 接続先スコープ切り替え時の queue 分離 (PASS)
  - T-10: finalization 失敗時の durable state 保持 (PASS)
  - T-11: 完了前 CAS 競合時の安全な abort (PASS)
  - T-12: 全 Handler の契約統一性検証 (PASS)
- **回帰テスト**:
  - `pnpm test`: 全 940 件のテストが 100% PASS (0 failing)
  - `pnpm run lint`: エラー 0 件
  - `pnpm run compile`: Webpack バンドル正常完了
