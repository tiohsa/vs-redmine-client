# 同期ライフサイクルの統合・非局所的整合性回復の決定ログ

日付: 2026-08-14
ステータス: 完了
関連課題: `docs/issue-20260814-2.md`

## 1. 概要と背景

`docs/issue-20260814-2.md` に基づき、チケット作成・更新・コメント作成・更新における同期ライフサイクル、状態遷移、非同期書き込み、CAS、再起動耐性、およびプレゼンテーションを統合・刷新しました。

## 2. 主要な決定事項と実装内容

### 2.1 不正な直接遷移の禁止と汎用ステートマシンの厳格化 (INV-09, INV-10, INV-11)
- `syncStateMachine.ts` において、`remote_committed` および `reconciliation_pending` から `completed` への直接遷移を禁止。
- 必ず `local_finalize_pending` を経由した上で、ローカル反映が成功した後にのみ `completed` に遷移する不変条件を確立。
- `retry_commit_unknown` アクションをステートマシンから完全削除。`commit_unknown` からの復帰は `assume_remote_commit` または `record_reconciled_identity` による明示的照合のみ許可。

### 2.2 CAS (Compare-And-Swap) と世代管理による競合防止 (INV-06, INV-07)
- `syncRepository.ts` (`DefaultSyncOperationRepository`) で `expectedPersistenceVersion` による CAS チェックを実装。
- ユーザー編集世代 `intentRevision` と CAS 世代 `version` / `persistenceVersion` を分離し、状態遷移を繰り返しても `intentRevision` が不変であることを保証。
- 処理中に後続の編集が発生した場合の `nextIntent` を保持し、`completeOperation` 時に新世代の operation として昇格（promoted）する仕組みを実装。

### 2.3 添付ファイルパイプラインの統合と Command バイパスの撤去 (INV-16, INV-17)
- `createTicketFromEditor` (`src/commands/createTicket.ts`) から `buildIssueMetadataFixture`（テスト用フィクスチャ）の import/参照を完全削除。本番の `getTicketEditorDefaults().metadata` を使用。
- コマンド内での先行添付アップロードを撤去し、`TicketCreateIntent` の `attachments` に含めて `SyncCoordinator` / `OperationHandler` の Saga パイプライン内で実行するように統合。

### 2.4 OutcomePresenter による統一プレゼンテーションと Ctrl+S (Auto) モード統合 (INV-19)
- `OutcomePresenter` (`src/app/outcomePresenter.ts`) を新設。
- `saveSyncExecutor.ts` の `syncIfAuto` において、`completed` / `no_change` のみならず、`conflict`, `commit_unknown`, `remote_committed`, `failed_before_commit` の全 Outcome を網羅して View の更新と通知を行うように統合。
- 通知オーナーを `OutcomePresenter` に単一化し、`notifications` 経由での重複通知（`showWarning`/`showError`）を防止。

### 2.5 コメント同期ライフサイクルの完全統合
- `CommentCreateHandler` および `CommentUpdateHandler` を新設し、画像アップロード・競合検知・Reconciliation・ローカルファイル反映（`updateCommentUpdateFileAfterSync` / `finalizeNewCommentDraftFileAfterSync`）の全フェーズを Coordinator 管理下に統合。
- `SyncEngine` のコメント処理および各コマンド（`editComment`, `addComment`, `commentPrompt`）をすべて `SyncCoordinator` 経由へ一本化。

## 3. 不変条件の検証 (Invariants Check)

| 不変条件 ID | 内容 | 検証結果 |
|---|---|---|
| INV-01 | Mutation 前の durable checkpoint (`remote_write_started`) | 適合 (`syncCoordinator.ts`) |
| INV-02 | 同一 operationId の single-flight 実行 | 適合 (`Map<flightKey, Promise>`) |
| INV-03 | 再起動時の `remote_write_started` -> `commit_unknown` 正規化 | 適合 (`normalizeOperationOnRestart`) |
| INV-04 | `commit_unknown` の自動再送禁止・明示的 reconciliation 必須 | 適合 (`syncCoordinator.ts` / `RT-05`) |
| INV-05 | `ConnectionScope` の厳格な分離 | 適合 (`runWithConnectionScope` & scope check) |
| INV-06 | CAS による二重更新・ロストアップデート防止 | 適合 (`syncRepository.ts` / `RT-E`) |
| INV-07 | 実行中の後続更新 (`nextIntent`) の新世代昇格 | 適合 (`syncRepository.ts` & `syncStateMachine.ts`) |
| INV-09 | `remote_committed` -> `completed` の直接遷移禁止 | 適合 (`syncStateMachineGeneric.test.ts` RT-05) |
| INV-10 | `reconciliation_pending` -> `completed` の直接遷移禁止 | 適合 (`syncStateMachineGeneric.test.ts` RT-05) |
| INV-11 | `local_finalize` 成功前の `completed` 遷移禁止 | 適合 (`syncCoordinator.ts`) |
| INV-16 | 本番コードからの `src/test/` 参照禁止 | 適合 (`syncLifecycleBoundary.test.ts` RT-01) |
| INV-17 | Entry Point からの直接 Redmine mutation 禁止 | 適合 (`createTicketCommandBypass.test.ts` RT-02) |
| INV-19 | 全 Outcome の Presentation / 通知 | 適合 (`saveSyncExecutorAutoMode.test.ts` RT-03, RT-04, `RT-F`) |

## 4. 実行した検証

- `pnpm run compile-tests`: 成功 (0 errors)
- `pnpm run compile`: 成功 (webpack bundle 931 KiB)
- `pnpm run lint`: 成功 (ESLint 0 errors, 0 warnings)
- `pnpm test`: 成功 (**908 件全テスト通過 (4s), 0 failing**)
