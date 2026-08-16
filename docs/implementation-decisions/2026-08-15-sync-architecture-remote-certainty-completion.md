# fix-bugs ブランチ Remote Certainty / Completion / Lifecycle 整合性修正 実装判断ログ

日付: 2026-08-15
ステータス: 完了 (952 tests passing, Lint passing)
プロジェクトルート: `/home/glorydays/projects/src/ts/vs-redmine-client`
参照元: `fix-bugs ブランチ変更指示`
実装対象: `src/app/ticketSync/`, `src/views/offlineSyncStore.ts`, `src/test/`

## 依頼と参照元の要約

`fix-bugs` ブランチにおける Remote Certainty, Durable Effect, Completion, Lifecycle Ownership の不整合（P1-01〜P1-04、不変条件 INV-N01〜INV-N07）を解決し、T-13〜T-24 の failure-first テストおよび T-06/T-09/T-12 の修正・強化を行い、全 952 件のテストを PASS させること。

## 不変条件の遵守状況 (INV-N01〜INV-N07)

- **INV-N01 (Primary Commit Evidence 不可逆原則)**:
  Primary Remote Write (TicketCreate/Update, CommentCreate/Update) が一度コミットされた後は、子チケット等の Secondary Effect の失敗やタイムアウトがあっても、Primary を `queued` や `failed_before_commit` に巻き戻さず、`remote_committed` (pending: "remote_reconcile") として証拠を保護。
- **INV-N02 (Primary Remote Certainty と Dependent Effect 状態の分離)**:
  Primary が committed であっても、未解決・不確実な Child Effect がある場合は `remote_committed` を返し、自動での二重同期・再送を抑止。
- **INV-N03 / INV-N04 (Prerequisite Effect 解決前の Primary mutation 禁止 & 冪等性保証)**:
  未解決な Prerequisite (添付ファイル/画像アップロード) が残っている状態での Primary 送信を禁止。Primary が already committed の場合、Primary PUT をスキップして未完了 Child Effect のみ実行。
- **INV-N05 (Fail-Closed Checkpoint)**:
  全 Remote Effect で Remote mutation 前の checkpoint (`planEffect`, `start`) 失敗時は remote mutation を即時中断（remote mutation count = 0）。
- **INV-N06 (Durable Commit Checkpoint Fail-Closed)**:
  Remote 成功後の commit checkpoint 失敗時は `commit_unknown` / `remote_committed` とし、`failed_before_commit` に戻さない。
- **INV-N07 (Durable Completion Guard)**:
  `completed` は Reconciliation -> Finalize -> Completion CAS (OfflineSyncStore での promotion / cleanup) の全成功時のみ返却。

## 判断一覧

### D-001 [テスト構成]
- **判断**: `src/test/syncLifecycleIntegrationT01toT12.test.ts` に T-13〜T-24 を追加・統合し、T-06/T-09/T-12 を最新の `createSyncCoordinator` 基盤に移行。

### D-002 [Primary Committed 判定と Rollback 拒絶ガード]
- **判断**: `syncStateMachine.ts` の `abort_known_remote_failure` および `abort_before_remote_write` で、Primary Effect が `committed` の場合はロールバックを拒絶し `undefined` を返すよう防御。親チケットの補償トランザクションが完全に成功して `state === "compensated"` になった場合のみロールバックを許可。

### D-003 [Child Effect 再開と自動再送の境界]
- **判断**: `syncCoordinator.ts` において、`operation.phase === "remote_committed"` の操作について、不確実または失敗した Child Effect（`commit_unknown`, `failed`, `compensation_*`）が残っている場合は自動同期からの再実行をブロックし、明示的リカバリを要求。Child が完全に完了している（または存在しない）場合は Step B (Reconciliation) -> Step C (Finalization) へ安全に再開して完了へ導く。

### D-004 [Saga 補償トランザクションの挙動]
- **判断**: `TicketCreateHandler` において、子チケット作成失敗時は作成済み子チケットおよび親チケットの DELETE（補償）を試行し、DELETE タイムアウト時は `mark_compensation_unknown` を記録して証拠を保護。`TicketUpdateHandler` においては、子チケット作成失敗時に既存の作成済み子チケットを勝手に DELETE せず、`committed` 証拠を保持したまま `remote_committed` を返却。

### D-005 [Complete CAS の直接呼び出し]
- **判断**: `syncCoordinator.ts` の Step C および `resolveCommitUnknown` において、`transitionOperation({ kind: "complete" })` の先行呼び出しを排除し、`completeOperation`（`completeOfflineNewTicketAsync` / `completeOfflineTicketUpdateAsync`）を単一のアトミックな完了・昇格トランザクションとして実行。

## 検証結果

- `pnpm run compile-tests`: 成功 (型エラー 0)
- `pnpm run compile`: 成功 (webpack バンドル生成)
- `pnpm run lint`: 成功 (ESLint エラー 0)
- `pnpm test`: **952 passing (0 failing, 0 pending)**

