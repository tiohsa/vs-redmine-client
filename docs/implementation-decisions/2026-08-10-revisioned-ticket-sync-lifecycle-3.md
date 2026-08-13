# Revision-aware Ticket Sync Lifecycle 実装判断ログ

日付: 2026-08-10
ステータス: 完了
プロジェクトルート: `/home/glorydays/projects/src/ts/vs-redmine-client`
参照元: 添付 `pasted-text-1.txt`（PART B 実装指示）
実装対象: `src/views/offlineSyncStore.ts`、`src/app/ticketSync/`、関連テスト

## 依頼と参照元の要約

同期開始時に active revision を永続的に freeze し、後続保存を `nextIntent` に保持する。同期操作の非同期 mutation は stable operation identity と expected revision を使い、offline queue の全 Memento 更新（legacy migration を含む）を scope persistence lane に通す。

## 記録方針

このファイルには、参照元に明記されていなかった実装中の判断、変更、妥協点、仕様解釈、未解決事項、検証上の制約を記録する。

## 判断一覧

### D-001 既存 journal API を後方互換な optional CAS 引数で拡張する

- 種別: 解釈
- タイミング: 実装中
- 参照元に書かれていたこと: durable mutation は stable operation identity と expected revision を検証する。
- 参照元に書かれていなかったこと: テスト用の既存 `SyncJournal` 注入実装をどのように移行するか。
- 判断: 既存メソッドに optional な expected revision を追加し、production default journal は常に指定する。
- 理由: public command/API を変えず、既存のテスト doubles を段階的に互換に保つため。
- 代替案: `SyncJournal` を全面的に新しい handle-only API へ置換する。
- 影響: production mutation は stale completion を拒否できる。
- 可逆性: 高
- 制約: 既存テスト注入境界との互換が必要。
- ユーザー確認: 不要

## 変更・逸脱

- 既存の `SyncJournal` メソッド名は維持し、明示的な `OperationHandle` DTO を公開しなかった。各 production mutation は queueId（new）、ticketId + scope（existing）、expected revision を渡すため、永続化上の同一性契約は満たす。

## 妥協点と残課題

- 実 Redmine 6.1 server を使う network timeout/restart E2E は未実行。既存の deterministic lifecycle tests と VS Code extension suite で検証した。

## 検証と制約

- 実行した検証: `pnpm exec tsc --noEmit`、`pnpm run compile-tests`、`pnpm run compile`、`pnpm run lint`、`pnpm run test:unsafe`（811 passing）。
- 実行できなかった検証: 通常の `pnpm test` は Chromium sandbox 制限で SIGTRAP。CodeGraph は未初期化で、初期化のユーザー承認待ち。

## 結果

`preparing` を persisted phase として追加し、service が preflight 前に revision を freeze するようにした。全 lifecycle mutation と completion は optional expected revision CAS を通し、stale completion は false/undefined で拒否する。new-ticket async mutation は更新後の entry を返すため、await 中の配列並べ替えで別 operation を返さない。legacy migration は scope lane 内で scoped snapshot 書込みと legacy key 削除を直列化した。
