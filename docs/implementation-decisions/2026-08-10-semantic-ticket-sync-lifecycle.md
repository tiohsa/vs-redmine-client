# Ticket Sync semantic lifecycle 実装判断ログ

日付: 2026-08-10
ステータス: 完了
プロジェクトルート: `/home/glorydays/projects/src/ts/vs-redmine-client`
参照元: `pasted-text.txt`（PART A 設計分析結果、PART B 最終実装指示）
実装対象: `src/views/offlineSyncStore.ts`、`src/app/ticketSync/`、関連テスト

## 依頼と参照元の要約

`preparing` 中の後続保存を `nextIntent` として保持する既存モデルを維持し、pre-remote abort・conflict・restart で最新 intent を queued active へ昇格させる。new ticket recovery の lifecycle mutation には revision CAS を渡し、対象テストを追加する。

## 記録方針

このファイルには、参照元に明記されていなかった実装中の判断、変更、妥協点、仕様解釈、未解決事項、検証上の制約を記録する。

## 判断一覧

### D-001 pre-remote abort を store の semantic transition として所有する

- 種別: 解釈
- タイミング: 実装中
- 参照元に書かれていたこと: abort は active revision を queued に戻すか、`nextIntent` を queued active に昇格する。
- 参照元に書かれていなかったこと: transition の配置と公開形。
- 判断: `offlineSyncStore` に new/existing 用 `abort...BeforeRemoteWriteAsync` を追加し、`SyncJournal` から利用する。
- 理由: phase・revision・nextIntent を同時に更新する永続状態の責務を service caller から取り除くため。
- 代替案: service 内で partial update と promotion を組み立てる。
- 影響: preflight failure と conflict が同一の CAS 付き promotion contract を共有する。
- 可逆性: 高。内部 journal 境界のみの変更。
- 制約: 制約により必須。
- ユーザー確認: 不要

### D-002 load 時の legacy `queued + nextIntent` も同じ promotion で正規化する

- 種別: 解釈
- タイミング: 実装中
- 参照元に書かれていたこと: `queued ⇒ nextIntent undefined` を runtime/restart の両方で保証する。
- 参照元に書かれていなかったこと: 既存の不完全な queued snapshot の復旧方法。
- 判断: `preparing` とともに queued snapshot も latest intent へ昇格して正規化する。
- 理由: 古い intent の復活を避け、唯一の queued revision を明確にするため。
- 代替案: nextIntent を単に破棄する。
- 影響: legacy queue は最新 local intent を優先して安全に再送できる。
- 可逆性: 中。次回永続化で正規化状態が保存される。
- 制約: 制約により必須。
- ユーザー確認: 不要

## 変更・逸脱

実装対象の lifecycle 以外（コメント同期、Redmine API、persistence lane）には変更していない。

## 妥協点と残課題

通常・unsafe VS Code test は Electron sandbox 制限によりテスト本体を実行できなかった。

## 検証と制約

- 実行した検証: `pnpm exec tsc --noEmit`、`pnpm run compile-tests`、`pnpm run lint`、`pnpm run compile`、`pnpm run test:unsafe`（814 passing）。
- 実行できなかった検証: 実 Redmine 6.1 を用いる network timeout/restart E2E。

## 結果

abort transition は latest `nextIntent` を active queued revision へ昇格し、restart も同じ正規化を使う。conflict は abort transition を実行してから outcome を返し、new-ticket recovery の retry/link mutation には取得済み revision を渡す。
