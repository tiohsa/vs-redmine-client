# 同期ライフサイクル統合・Remote Certainty / Durable Effect 修正計画書

日付: 2026-08-15
ステータス: 進行中
プロジェクトルート: `/home/glorydays/projects/src/ts/vs-redmine-client`

## 1. 目的

本計画の目的は、`fix-bugs` で観測される個別不具合を局所修正することではなく、同期処理に共通する以下3つの根本原因を完全に閉じることである。

1. **Primary Remote Commit と Secondary Effect の確定性が同じ operation phase に混在している (RC-1)**
2. **Persistent State の変更・CAS・完了処理が「durable に成功したこと」を実行側が保証していない (RC-2)**
3. **Lifecycle / Restart normalization / State ownership が複数実装として残っている (RC-3)**

本修正完了後は、次の不変条件（INV-U01 〜 INV-U16）を構造的および自動テストで成立させる。

* Remote mutation が実行される前に、その mutation の `started` checkpoint が永続化まで成功している (INV-U03)
* `remote_committed` は Primary mutation の確定性のみを表す (INV-U01, INV-U02)
* attachment / image / child 等の Secondary Effect は個別に durable に追跡される
* 未確定な Effect が1件でもあれば通常同期から自動再送しない (INV-U05)
* VS Code Extension Host 再起動後も committed / uncertain effect を失わない (INV-U07)
* stale revision が現在の operation / effect を変更できない (INV-U08)
* local finalize と queue cleanup が完了して初めて `completed` を返す (INV-U12)
* Persistent lifecycle を変更できる owner は1つ（`SyncOperationRepository`）だけになる (INV-U14)
* Runtime lifecycle boundary から `any` / unchecked DTO を排除する (INV-U15)

---

## 2. 確定不具合と根本原因の対応

| 不具合ID | 概要 | 根本原因 |
|---|---|---|
| P1-01 | Secondary Effect の状態だけで operation を `remote_committed` にできる（CommentUpdate 画像失敗時に本文未送信で完了扱いになる silent data loss） | RC-1 |
| P1-02 | Durable checkpoint 成功（Repository の戻り値）を確認せず Remote mutation を実行している | RC-2 |
| P1-03 | Persistent State は Memento 失敗時に memory と storage の整合性を保証していない（先に memory を破壊） | RC-2 |
| P1-04 | 実際の Process Restart（`initializeOfflineSyncStore`）で committed attachment/image effect が失われる（`effects: []` に初期化） | RC-3 |
| P1-05 | Secondary Effect 成功後に Primary が既知失敗すると ledger を消去する（TicketUpdate child 作成順序問題） | RC-1, RC-3 |
| P1-06 | Effect revision fence が Repository 層で無効化されている（`expected.operationRevision` が無視） | RC-2 |
| P1-07 | `completed` の返却と Persistent cleanup が atomic ではない（二段階完了の race / CAS 失敗の未検査） | RC-2 |
| P2-01 | State Ownership / lifecycle contract の統合が未完了（旧ライフサイクル実装の残存、`any` の残存） | RC-3 |

---

## 3. 採用方針 (案D: 状態ライフサイクル全体の統合)

* **Prerequisite / Primary / Dependent の厳格な分離**:
  - Prerequisite: attachment upload, markdown image upload（Primary 前に実行）
  - Primary: ticket create/update, comment create/update（Remote Certainty の唯一のソース）
  - Dependent: child create, compensation（Primary commit 後に実行。TicketUpdate では Primary PUT → child create の順）
* **Atomic / Acknowledged Persistence**:
  - Immutable next snapshot 生成 → Memento persist → 成功後に memory snapshot publish。失敗時はロールバック。
  - Repository の mutation API は `{ applied: true }`, `{ conflict: true }`, `{ persistence_failed: true }`, `{ not_found: true }` を明確に区別。
* **Effect-specific Recovery**:
  - `commit_unknown` の原因 Effect を一意に識別し、未確定 Effect がある場合は Primary mutation を再送しない。
* **Restart Normalization の単一化**:
  - `initializeOfflineSyncStore` を通る production restoration と state-machine で単一の normalizer を使用。committed effect を保持。
* **Atomic Completion Protocol**:
  - phase = completed への遷移と queue cleanup / nextIntent 昇格を Repository 側で 1 つのトランザクションとして実行。

---

## 4. Failure-First テスト (T-01 〜 T-12)

1. **T-01**: Secondary commit ≠ Primary commit (CommentUpdate で画像A成功・画像B失敗時に updateComment が呼ばれず、completed にならず、queue が保持される)
2. **T-02**: Child success → Primary known failure (TicketUpdate で child 作成後に Primary PUT が 400 失敗しても committed child ledger を消去しない/次回重複作成しない)
3. **T-03**: True Restart: Attachment (Memento 永続化 → `initializeOfflineSyncStore` 復元後も committed token が残り、二重アップロードしない)
4. **T-04**: True Restart: Markdown Image (T-03 と同様)
5. **T-05**: Persistence failure before mutation (started checkpoint 永続化失敗時に Remote mutation が呼ばれず、メモリ・永続層がロールバックされる)
6. **T-06**: Persistence failure after Remote success (Remote 成功後の terminal checkpoint 永続化失敗時に completed にならず、自動再送されない)
7. **T-07**: Stale Effect Revision (expectedRevision 不一致で transition が拒否される)
8. **T-08**: Completion CAS race (completion 中に nextIntent/revision 変更があった場合、false completed にならず nextIntent が保持される)
9. **T-09**: Secondary Unknown Recovery (image effect = commit_unknown の時に Primary retry を拒否する)
10. **T-10**: Primary Certainty Invariant (任意の attachment/image/child だけが committed の場合、operation.phase は remote_committed にならない)
11. **T-11**: Production Restart Normalizer (`initializeOfflineSyncStore` で committed effects が保持される)
12. **T-12**: Ownership Boundary (本番コードで persistent lifecycle mutation が storage adapter へ直接到達していない)

---

## 5. 実装ステップ

1. **T-01〜T-12 の failure-first tests 実装** (`src/test/syncRemoteCertaintyRT.test.ts`)
2. **Canonical Contracts & Types の定義** (`src/app/ticketSync/syncOperationTypes.ts`, `ports.ts`)
3. **Atomic Persistence & Fail-Closed Repository 実装** (`src/views/offlineSyncStore.ts`, `src/app/ticketSync/syncRepository.ts`)
4. **Restart Normalization 統一** (`src/views/offlineSyncStore.ts`, `src/app/ticketSync/syncStateMachine.ts`)
5. **Coordinator / Handlers の実行順序・確定性分離** (`src/app/ticketSync/syncCoordinator.ts`, `src/app/ticketSync/operationHandlers.ts`)
6. **Effect-specific Recovery の統合**
7. **Atomic Completion の統合**
8. **Legacy Lifecycle 撤去 & Facade 統一** (`src/app/ticketSync/ticketSyncService.ts`)
9. **全テスト実行・検証** (`lint`, `compile-tests`, `compile`, `pnpm test`, `package`)
10. **意思決定ログの更新** (`docs/implementation-decisions/2026-08-15-sync-lifecycle-unification-remote-certainty.md`)
