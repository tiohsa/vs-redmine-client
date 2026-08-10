# TicketSyncService と durable sync lifecycle 実装判断ログ

日付: 2026-08-10
ステータス: 完了
プロジェクトルート: `/home/glorydays/projects/src/ts/vs-redmine-client`
参照元: `pasted-text-1.txt` の背景・期待仕様、レビュー結果、アーキテクチャ変更指示、必須回帰テスト
実装対象: `src/app/ticketSync/`、ticket sync、offline queue、commands、Dashboard、関連テスト

## 依頼と参照元の要約

同期という副作用境界を `TicketSyncService` に集約し、remote create once、durable-before-complete、remote canonical after commit、unknown revision の非同期扱い、明示的 connection ownership、caller 視点での atomic local finalization を実現する。

## 記録方針

このファイルには、参照元に明記されていなかった実装中の判断、変更、妥協点、仕様解釈、未解決事項、検証上の制約を記録する。

## 判断一覧

### D-001 既存 OfflineSyncQueue を SyncJournal の永続化媒体として拡張する

- 種別: 解釈
- タイミング: 実装前
- 参照元に書かれていたこと: `OfflineNewTicket.createdIssueId` を活用してよく、同期 lifecycle の正は OfflineSync/SyncJournal に置く。
- 参照元に書かれていなかったこと: SyncJournal を別 storage key とするか、既存 queue schema を拡張するか。
- 判断: `OfflineNewTicket` と `OfflineTicketUpdate` に optional phase/reconciliation field を追加し、既存 queue を journal port の backing store とする。
- 理由: queue と journal を別々にすると operation identity と cleanup の整合性を維持する追加 transaction が必要になる。既存 `createdIssueId` と legacy migration を直接利用する方が durable lifecycle の正を一つにできる。
- 代替案: 独立した `redmine.syncJournal.*` Memento key を追加する。
- 影響: 保存形式は additive。既存 entry は field 欠落時に legacy `queued` として読み込める。
- 可逆性: 中。後から repository 実装を別 key へ移せるが migration が必要。
- 制約: 任意判断
- ユーザー確認: 事後報告

### D-002 永続化 barrier 用 API と既存同期 API を併存させる

- 種別: 技術制約
- タイミング: 実装前
- 参照元に書かれていたこと: remote commit 識別情報の persistence 完了を await 可能にする。
- 参照元に書かれていなかったこと: 既存 store mutation の戻り値を一括変更するか。
- 判断: remote commit/finalize で使う async mutation API を追加し、既存 void API は互換性のため残す。
- 理由: 既存 store API は多数の UI/保存経路から同期的に呼ばれている。全呼び出し元を同時に async 化すると同期 lifecycle と無関係な変更が広がる。
- 代替案: すべての mutation を Promise 戻り値へ破壊的変更する。
- 影響: application service では durability を保証し、既存 convenience path は挙動を維持する。
- 可逆性: 高。段階的に async API へ統合可能。
- 制約: 任意判断
- ユーザー確認: 不要

### D-003 Extension Host tests は sandbox 外の検証実行で完了させる

- 種別: 検証制約
- タイミング: 検証中
- 参照元に書かれていたこと: Extension Host tests を green にする。
- 参照元に書かれていなかったこと: container 内で Chromium sandbox を無効化する具体的方法。
- 判断: `pnpm test` と既存 `pnpm run test:unsafe` の sandbox 内失敗点を確認した後、承認された sandbox 外実行で `pnpm run test:unsafe` を完走させる。専用 config で launch args を明示する案も試したが同じ `SIGTRAP` だったため、効果のない設定変更は残さない。
- 理由: compile-tests、webpack、lint は通過してから Extension Host 起動時だけ失敗しており、テストコードの failure ではなく container の Chromium sandbox host 制約である。
- 代替案: CI または GUI/Electron を起動可能なホストで Extension Host tests を実行する。
- 影響: sandbox 外の Extension Host で 781 tests passing を確認した。compile-tests・bundle・lint も同じ command の pretest で成功した。
- 可逆性: 高。実行可能な環境で同じコマンドを再実行できる。
- 制約: 検証環境により必須
- ユーザー確認: 事後報告

### D-004 child create rollback failure 時も parent issue ID を journal する

- 種別: 仕様ギャップ
- タイミング: 実装中
- 参照元に書かれていたこと: 子チケット処理は将来 journal 化可能な境界にし、新規チケットは最大1件だけ作成する。
- 参照元に書かれていなかったこと: child create failure 後に parent delete rollback 自体が失敗した場合の新規 operation の扱い。
- 判断: parent delete が成功した場合だけ通常の pre-commit failure とし、delete が失敗した場合は `createdId` を service へ返して durable journal に保存し、read-back/finalize へ進む。
- 理由: rollback failure を単純 failure にすると次回 retry が parent を再作成し、最重要不変条件の remote create once を破る。
- 代替案: child error 時は常に parent を残す、または child create 全体を今回完全 journal 化する。
- 影響: rollback failure 時は parent ticket を重複させず、残存した remote ticket を canonical state として回収できる。child error の詳細な再開は後続課題として残る。
- 可逆性: 中。完全な child operation journal 導入時に置き換えられる。
- 制約: 制約により必須
- ユーザー確認: 事後報告

### D-005 untitled/file URI は同じドキュメント identity として扱う

- 種別: 仕様解釈
- タイミング: 実装中
- 参照元に書かれていたこと: queue operation は `documentUri` を保持し、finalization を caller 視点で atomic にする。
- 参照元に書かれていなかったこと: untitled draft が保存されて file URI へ変化した場合の operation identity。
- 判断: URI の scheme 変化を正規化し、同じ保存先を指す untitled/file entry を同一 document operation として merge・cleanup する。
- 理由: stale untitled entry と current file entry が並存すると、同じ draft に対する二重同期または完了後の残留 queue が起こる。
- 代替案: URI 文字列をそのまま operation identity とする。
- 影響: 保存前後の draft は同じ durable operation として再開される。
- 可逆性: 中。明示的 document UUID を導入する場合は置き換え可能。
- 制約: 任意判断
- ユーザー確認: 事後報告

### D-006 Markdown 見出しからの作成も service のみへ移す

- 種別: アーキテクチャ整合
- タイミング: 実装中
- 参照元に書かれていたこと: ticket sync の remote create/update orchestration は application service が所有する。
- 参照元に書かれていなかったこと: `createTicketFromMarkdownHeader` のテスト用 dependency injection 互換性をどう扱うか。
- 判断: 当初は legacy `createTicket` dependency を互換 façade として残したが、完了監査で command から呼べる service bypass も「唯一の同期入口」に反すると判断し撤去した。command は `TicketSyncOutcome` の presentation のみを行い、production は `syncEditor()` を呼ぶ。
- 理由: production の既定値だけでなく、実装上存在する全 command 経路から remote/rewrite/registry orchestration を除くため。
- 代替案: legacy dependency をテスト専用として残す。
- 影響: command の内部 dependency injection contract は変更されるが、公開 command ID と利用者向け挙動は維持される。
- 可逆性: 中。旧 façade は復元可能だが architecture invariant を再び弱める。
- 制約: 任意判断
- ユーザー確認: 事後報告

### D-007 Sync All の item loop は service が所有する

- 種別: 仕様整合
- タイミング: 完了監査
- 参照元に書かれていたこと: `syncAll()` 自身が queue item を順次 `syncQueueItem()` へ渡す。
- 参照元に書かれていなかったこと: VS Code progress cancellation を service 境界でどう維持するか。
- 判断: `TicketSyncService.syncAll()` に optional `shouldContinue` callback を追加し、`offlineSync` は service を一度だけ呼んで outcomes の表示・集計だけを行う。
- 理由: command 側の item loop は挙動が同じでも transaction ownership を二重化する。callback により item 間キャンセルも維持できる。
- 代替案: command が `syncQueueItem()` を直接ループし続ける。
- 影響: Sync All の ticket/new-ticket iteration と remote side effect ownership が service に一本化された。comment sync は今回の ticket scope 外として従来経路を維持する。
- 可逆性: 高。
- 制約: 仕様により必須
- ユーザー確認: 不要

### D-008 Registry と Draft を new-ticket local-state port にする

- 種別: 責務分離
- タイミング: 完了監査
- 参照元に書かれていたこと: local finalization は Markdown、registry、draft、queue の順序を一箇所で所有する。
- 参照元に書かれていなかったこと: 順序を failure injection test でどう観測するか。
- 判断: `NewTicketLocalStatePort` を追加し、finalizer が Markdown rewrite 後に registry、draft の順で呼ぶ。既定 port は既存 store/registry を利用する。
- 理由: 直接 import のままでは順序を単体テストで観測できず、実装も draft→registry の逆順だった。
- 代替案: 直接呼び出しを単純に並べ替え、source text test だけを置く。
- 影響: application service が local-state dependencies を明示し、順序回帰を behavior test で検出できる。
- 可逆性: 高。
- 制約: 仕様により必須
- ユーザー確認: 不要

### D-009 Connection execution runner を注入可能にする

- 種別: テスト容易性
- タイミング: 完了監査
- 参照元に書かれていたこと: Aで開始した処理は途中で設定がBへ変わってもAの context で完了する必須テスト。
- 参照元に書かれていなかったこと: AsyncLocalStorage の内部状態を service test からどう観測するか。
- 判断: production default は既存 `runWithConnectionScope` のまま、service dependency として runner を注入可能にする。
- 理由: network server や global VS Code settings を操作せず、service が明示 context を execution runner へ渡す事実を直接検証できる。
- 代替案: HTTP server を使った integration test、または source text inspection。
- 影響: production behavior は不変で、connection ownership の回帰テストが追加された。
- 可逆性: 高。
- 制約: 任意判断
- ユーザー確認: 不要

## 変更・逸脱

production の同期入口は service に集約した。既存の低レベル関数は service 内部の adapter として残すが、command/Dashboard から組み合わせる経路は削除した。

## 妥協点と残課題

CodeGraph は未初期化であり、初期化許可が得られなかったため既知ファイルの直接調査で実装した。GitHub Actions は `main` の直近5件が green だが、未コミット差分では起動できず、`fix-20260810` に workflow run がないためローカル同等ゲートまでを検証した。

## 検証と制約

- `rtk pnpm run test:unsafe`: 786 passing、終了コード 0（compile-tests、webpack、lint を含む）。
- `rtk proxy pnpm exec tsc --noEmit`: 成功。
- `rtk pnpm run lint`: 成功（既存 `.eslintignore` の非推奨警告のみ）。
- `rtk pnpm run compile`: 成功。
- `rtk git diff --check`: 成功。
- 実行できなかった検証: GitHub Actions（ローカルの未コミット差分には実行対象 commit がないため）。

## 結果

実装とローカル検証を完了した。remote create once、durable barrier、reconciliation-only retry、canonical finalization、entry-point parity を回帰テストで確認した。
