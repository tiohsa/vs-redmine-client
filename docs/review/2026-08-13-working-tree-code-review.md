# Code Review: working-tree

## Scope

`Revision-Fenced Durable Sync Effects` 仕様に対するworking tree全体をレビューした。対象はTicket create/update、child create/compensation、Comment create/update/recovery、document finalization、workspaceState v3 migration、Sync All accounting、production entry-point境界、README/Locale、関連testである。

差分が大規模なため、remote mutation前後のdurable barrier、restart normalization、compensation partial failure、Comment identity recovery、document freshness、active/next revision、scope isolation、batch accountingを優先して確認した。

## Findings

現時点でコード上の未解消findingはない。

レビュー中に以下を検出し、最終版では修正・回帰test追加済みである。

- `preparing` の一律restart normalizationがcommitted child effectを消す経路
- compensation checkpoint失敗後にabort cleanupがcommitted childを消す経路
- Comment `commit_unknown` / `created_unresolved` に安全な明示recoveryがない経路
- 新規Comment draftのremote identityをlocal documentへ保存せずqueueをcompleteし、restart後に再POSTできる経路
- closed/non-visible documentをversion fenceなしでfinalizeし得る経路

## Open Questions

- Redmine 6.1のupload tokenは完全にtemporaryか。失敗/retryでduplicate attachmentまたはorphan resourceになる場合、upload自体をdurable effect ledgerへ追加する必要がある。
- child POST response loss後に、parent ID・subject・author・creation time・children listingからremote childを一意に再同定できるか。現実装は同定不能を前提に自動retry/compensationを禁止する。

## Summary

- 4種のoperationをoperation/revision/effect ledgerで統合し、known-committed effectの再送とunknown writeの自動retryを禁止した。
- parent/child IDとcompensation結果をdependent effect前にdurable保存し、restartでも保持する。
- Comment POST/PUTをqueue-first lifecycle owner配下へ移し、created-unresolved、timeout、一意/手動journal reconciliation、draft identity finalizationを実装した。
- local rewrite/saveはfreshness compare-and-applyでfail closedにし、active revisionとbounded nextIntentを維持する。
- v1/v2 reader互換を保ったv3 envelope、scope isolation、single-flight、cancel accounting、public adapter境界を追加した。

## Verification

- `pnpm run compile-tests`: 成功
- `pnpm run compile`: 成功
- `pnpm run lint`: 成功（既存の`.eslintignore`廃止警告のみ）
- `pnpm exec tsc --noEmit`: 成功
- `git diff --check`: 成功
- VS Code 1.133.0 Extension Host: 873 passing
- VS Code 1.107.0 Extension Host: 873 passing
- I-01〜I-20: ID付き自動testあり

検証限界: 実Redmine 6.1のserver URL、test credential、E2E harnessがリポジトリ/環境にないため、ticket/comment create/update、child create、connection abort、restart recovery、upload semanticsの実サーバーE2Eは未実行。このE2Eは参照仕様のrelease gateであり、merge/release ready判定は保留する。
