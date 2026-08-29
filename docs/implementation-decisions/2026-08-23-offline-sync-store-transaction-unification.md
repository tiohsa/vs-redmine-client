# Offline Sync Store Transaction Unification / Recovery Semantics 改善 実装判断ログ

日付: 2026-08-23
ステータス: 完了
プロジェクトルート: `/home/glorydays/projects/src/ts/vs-redmine-client`
参照元: `docs/review-20260823-5.md`
実装対象: `src/views/offlineSyncStore.ts`、production queue mutation call site、Recovery Policy/UI/API、関連テスト

## 依頼と参照元の要約

同一 `connectionScope` の全 Queue mutation を、scope 単位の単一 transaction primitive に統一し、`read → validate/CAS → modify → persist → memory publish` を同じ critical section 内で行う。あわせて、安全な自動 action がない `compensation_blocked` を `manual_repair_required` として明示し、既存の Attempt Closure、generation/revision fence、Effect ledger、fail-closed recovery を維持する。

## 記録方針

このファイルには、参照元に明記されていなかった実装中の判断、変更、妥協点、仕様解釈、未解決事項、検証上の制約を記録する。

## 判断一覧

### D-001 同期 mutation API の扱いは production call site の完全移行を優先する

- 種別: 解釈
- タイミング: 実装前
- 参照元に書かれていたこと: production code から同期 mutation を原則廃止し、互換性のため残す場合も live memory を直接変更せず runtime mutation path から隔離する。
- 参照元に書かれていなかったこと: 公開済みテスト helper と production API の互換性をどこまで同一変更で破壊してよいか。
- 判断: まず production call site を async API へ完全移行し、同期 API は呼出し状況と既存テスト互換性を監査した上で、削除または明確な test/setup 専用境界へ縮小する。同期 API が live memory を直接変更する状態は完了条件として残さない。
- 理由: 仕様の最重要不変条件を満たしつつ、テスト fixture の大量な機械変更を先に行って実運用経路の競合を見落とすことを避けるため。
- 代替案: 同期 API を直ちに削除して全 call site を一括変更する。影響範囲監査前の破壊的変更になるため保留した。
- 影響: production API は await 必須になる。同期 helper を残す場合も transaction 外の writer としては使用できない。
- 可逆性: 中。同期 API の互換 shim を後から戻すことは可能だが、live mutation の復活は不可。
- 制約: 仕様により必須。
- ユーザー確認: 不要

### D-002 Repository の CAS は Store candidate を直接更新する

- 種別: 設計
- タイミング: 実装中
- 参照元に書かれていたこと: stale whole-queue replacement を禁止し、repository の revision / generation fence を storage layer が破壊しないこと。
- 参照元に書かれていなかったこと: Repository 自身の scope mutex と Store mutex の責務分担。
- 判断: Repository の既存 mutex は lifecycle 操作の直列化に残し、永続 CAS は `mutateOfflineSyncQueueAsync()` を通して Store が lock 取得後に渡す candidate 上で行う。Repository から whole queue を置換しない。
- 理由: operation 取得、version/generation 検証、payload 更新、persist、memory publish を Store の同一 critical section に閉じ込められるため。
- 代替案: Repository mutex 内で live snapshot を取得して `replaceOfflineSyncQueueAsync()` する。Store mutation と競合して unrelated operation を消すため不採用。
- 影響: Store と Repository の同一 scope 再入を `AsyncLocalStorage` で許可する必要がある。
- 可逆性: 低。stale replacement へ戻すことは不変条件違反になる。
- 制約: 仕様により必須。
- ユーザー確認: 不要

### D-003 未永続 candidate の pending snapshot 復元を廃止する

- 種別: 設計
- タイミング: 実装中
- 参照元に書かれていたこと: persistence 成功前に candidate を live memory へ公開せず、失敗時は memory と disk の双方を旧状態に保つこと。
- 参照元に書かれていなかったこと: `pendingSnapshotByScope` を transaction 統一後も維持するか。
- 判断: pending snapshot coalescing と再初期化時の pending candidate 復元を削除し、1 transaction = 1 persisted candidate とする。
- 理由: 未完了 write の candidate を再初期化後の memory に復元すると persist-first 原則を破るため。
- 代替案: pending/committed/persisted の三状態を別 ledger として管理する。今回の用途に対して複雑で YAGNI のため不採用。
- 影響: write は scope ごとの persistence lane で順次完了する。
- 可逆性: 中。
- 制約: なし。
- ユーザー確認: 不要

### D-004 Queue candidate と read snapshot は深い参照共有を断つ

- 種別: 安全性
- タイミング: 独立監査後
- 参照元に書かれていたこと: candidate container を clone し、対象 operation を clone して更新すること。
- 参照元に書かれていなかったこと: 公開 getter が返す nested Effect / RequestSnapshot の参照共有への対処。
- 判断: transaction candidate と公開 getter の返却値に `structuredClone()` を用いる。
- 理由: callback や caller が nested object を誤って変更しても live queue を persistence 前に変更できない構造にするため。
- 代替案: 全 mutation 箇所で対象 operation だけを手動 deep clone する。将来 field が増えた際の漏れを防ぎにくいため不採用。
- 影響: mutation ごとに O(N) の clone が発生するが、既存の whole-queue serialize も O(N) であり O(N²) は導入しない。
- 可逆性: 高。
- 制約: Node.js Extension Host の `structuredClone` を利用する。
- ユーザー確認: 不要

### D-005 Recovery dead-end は理由付き manual repair として fail closed にする

- 種別: 仕様解釈
- タイミング: 実装中
- 参照元に書かれていたこと: `COVERAGE_MISSING`、`INVARIANT_VIOLATION`、安全な action がない recovery を `manual_repair_required` として明示し、forward mutation を禁止すること。
- 参照元に書かれていなかったこと: synthetic operation-level blocker をどの Recovery Item に対応付けるか。
- 判断: effect に対応する blocker は当該 item に理由を付け、effect を持たない operation-level blocker は `__primary__` の synthetic item として公開する。安全な action がある item は従来どおり `actionable` とする。
- 理由: 空 action list だけでは UI/API 利用者が dead-end と欠落を区別できないため。
- 代替案: warning 文言だけを追加する。API classification が曖昧なままになるため不採用。
- 影響: Recovery Item に `disposition` と `manualRepairReason` が追加され、UI は自動 action を表示する前に警告する。
- 可逆性: 高。
- 制約: fail closed を維持し、unknown remote resource を自動削除しない。
- ユーザー確認: 不要

### D-006 同期 writer は互換 shim を残さず削除する

- 種別: 変更
- タイミング: call site 監査後
- 参照元に書かれていたこと: production 同期 writer を原則廃止し、残す場合も live memory を変更させないこと。
- 参照元に書かれていなかったこと: テスト専用互換 shim の要否。
- 判断: 同期 writer を削除し、production と既存テストを async API + `await` へ移行する。T06 は仕様どおり不要とする。
- 理由: 二重 mutation model を型・API レベルで再導入できないようにするため。
- 代替案: deprecated fire-and-forget shim。完了前に呼出元へ成功を返し durability を誤認させるため不採用。
- 影響: 保存 helper とテスト callback の一部が async になる。
- 可逆性: 中。
- 制約: production caller は必ず await する。
- ユーザー確認: 不要

## 変更・逸脱

- `replaceOfflineSyncQueueAsync()` は controlled test setup との互換性のため export を維持した。ただし production caller は 0 件であり、通常 operation 更新はすべて `mutateQueueAsync()` 内へ移した。
- 既存 T-32 のコメントは Attempt Closure 後に generation 2 へ進む仕様を述べていた一方、期待値だけ generation 1 / compensated effect 維持となっていた。Store 永続化統合により不一致が顕在化したため、仕様どおり generation 2 / current-generation effects 消去を検証する期待値へ修正した。

## 妥協点と残課題

- 通常 `pnpm test` と sandbox 内 `pnpm run test:unsafe` は Chromium sandbox の `Operation not permitted` / SIGTRAP で Extension Host を起動できなかった。許可済みの sandbox 外実行で同等の full Extension Host suite を検証した。
- 基準コミットと同一の `origin/fix-bugs` を追跡するローカル `fix-bugs` へ変更を保持したまま切り替え、PR #54 を作成した。

## 検証と制約

- 実行した検証:
  - CodeGraph と literal audit による `getQueue()`、`queuesByScope.set()`、collection mutation、`persistAsync()`、`replaceOfflineSyncQueueAsync()`、同期 writer call site の横断確認。
  - GPT-5.6 Luna xHigh sub-agent による独立監査。stale Repository replacement、primitive 外 persistence、pending candidate 復元、manual repair 欠落、shallow getter を指摘として取り込み済み。
  - 新規 deterministic transaction test T01–T05 / T07–T12（11件）。T06 は同期 writer 削除により対象外。
  - Recovery R01–R04。R02 は coverage missing attachment の通常 sync で forward handler 0 回と evidence 維持を直接検証。
  - `pnpm run compile-tests`: 成功。
  - `pnpm run compile`: webpack 5.104.1、成功。
  - CI と同じ `pnpm exec tsc --noEmit`: 成功。
  - `pnpm run lint`: 成功（既存 `.eslintignore` deprecation warning のみ）。
  - sandbox 外 Extension Host full suite: 1100 passing、0 failing。
  - PR #54 GitHub Actions `CI`: 成功。最終 HEAD の check と mergeability を再確認する。
- 実行できなかった検証:
  - ローカルでの CI 完全再現用 `xvfb-run`: 実行環境に `xvfb-run` が未導入のため。ただし GitHub Actions の `xvfb-run` 経路と、同じ Electron sandbox 環境変数を用いたローカル Extension Host full suite は成功した。

## 結果

実装、ローカル検証、PR GitHub Actions を含む受け入れ条件を完了した。
