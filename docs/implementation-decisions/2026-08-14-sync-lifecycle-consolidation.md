# 同期ライフサイクル統合・非局所的整合性回復 実装判断ログ

日付: 2026-08-14
ステータス: 完了 (Completed)
プロジェクトルート: `/home/glorydays/projects/src/ts/vs-redmine-client`
参照元: `同期ライフサイクル統合・非局所的整合性回復 変更仕様書` (HEAD: `15c8b09`)
実装対象: `src/app/ticketSync/*`, `src/app/syncEngine.ts`, `src/app/saveSyncExecutor.ts`, `src/views/offlineSyncStore.ts`, `src/views/commentSaveSync.ts`

## 依頼と参照元の要約

新 `SyncCoordinator` / `UnifiedSyncOperation` architecture への完全移行を行い、旧 `TicketSyncService` ライフサイクル、二重 contract、secondary remote effect、recovery contract を唯一の production lifecycle に統合する。不変条件 INV-01 〜 INV-26 を満たし、テスト仕様 RT-01 〜 RT-09 および既存全テストを完全にパスさせる。

## 記録方針

このファイルには、参照元に明記されていなかった実装中の判断、変更、妥協点、仕様解釈、未解決事項、検証上の制約を記録する。

## 判断一覧

### D-001 Coordinator への一本化と TicketSyncService の委譲ラッパー化

- 種別: アーキテクチャ判断
- タイミング: 実装前
- 参照元に書かれていたこと: production primary lifecycle owner = 1 (INV-13)、旧 TicketSyncService lifecycle ownership 撤去。
- 参照元に書かれていなかったこと: 既存テスト（908 件）で `TicketSyncService` をインスタンス化してテストしているケースへの互換性方針。
- 判断: `TicketSyncService` の公開 API（`syncEditor`, `syncQueueItem`, `syncAll`, `resolveCommitUnknown` 等）は維持し、内部を `SyncCoordinator` への委譲呼び出しに置き換える。
- 理由: 既存テストを壊さずにライフサイクルの真の実行主体を Coordinator 1 つに集約できるため。
- 代替案: `TicketSyncService` クラス自体を完全に削除する（既存テストの大量修正が必要になり回帰リスクが高い）。
- 影響: 将来的に TicketSyncService の呼び出し元を直接 SyncEngine / SyncCoordinator に移行可能。
- 可逆性: 高
- 制約: 制約により必須
- ユーザー確認: 事後報告

### D-002 CommentUpdate recovery の remote body 照合の厳格化

- 種別: 仕様ギャップ解消
- タイミング: 実装中
- 参照元に書かれていたこと: CommentUpdateHandler.reconcileRemote は remote detail から ticketId, commentId, body を照合する (INV-24)。
- 参照元に書かれていなかったこと: body の空白正規化や authorId の考慮。
- 判断: 既存の `normalizeCommentBody` を用いて、リモートコメントの body と intent の body を照合する。一致しない場合は `ok: false` を返し、completed に進めない。
- 理由: タイムアウト時に remote 側で未更新であるにもかかわらず recovery 成功と誤判定されることを防ぐため。
- 代替案: 特になし
- 影響: RT-01 のテストが正しくパスする。
- 可逆性: 高
- 制約: 仕様書で要求
- ユーザー確認: 不要

### D-003 Preflight（メタデータ解決）の prepare への移行と CAS 競合の厳格化

- 種別: 競合・ライフサイクル整合性
- タイミング: 実装中
- 参照元に書かれていたこと: Preflight 準備（`prepare`）と Remote Write（`executeRemoteWrite`）の責務分離、CAS 遷移の排他性 (INV-06, INV-07, INV-12)。
- 参照元に書かれていなかったこと: `TicketCreateHandler` において `resolveMetadataForCreate` が `executeRemoteWrite` 内で実行されていたことによる preflight 中の割り込み不可。
- 判断: `resolveMetadataForCreate` を `prepare`（`PreparedTicketCreate` への格納）で完了させ、`executeRemoteWrite` では解決済みメタデータを利用して直ちにリモート通信を開始する。また `link_remote_ticket` などの明示的 Link は CAS 遷移を優先実行して `remote_write_started` への二重遷移を完全に遮断する。
- 理由: preflight 中に明示的 Link や外部更新が割り込んだ際、CAS 判定で排他的に一方のみを進めるため。
- 代替案: 特になし
- 影響: RT-02（Retry と Link の競合）が完全パス。
- 可逆性: 高
- 制約: 仕様書で要求
- ユーザー確認: 不要

### D-004 Secondary Effects 失敗・未確定時のキュー保護と親チケット保護

- 種別: 障害分離・リカバリ保護
- タイミング: 実装中
- 参照元に書かれていたこと: Secondary Effects の障害時におけるロールバック・補償と未確定エフェクトの保持 (INV-04, INV-14)。
- 参照元に書かれていなかったこと: 子チケット作成が 400 等で失敗した後に親チケットの更新（PUT）に進んでしまわないためのガード。
- 判断: `TicketUpdateHandler.executeSecondaryEffects` で `failed` または `commit_unknown` / `compensation_unknown` のエフェクトが残存している場合、`{ ok: false }` を返して親チケットの更新を防止し、`SyncCoordinator` は `record_remote_commit`（pending: `"remote_reconcile"`）としてキューを保護する。
- 理由: 子チケットが作成されていない状態で親チケットだけが更新完了される重大な不整合を防止するため。
- 代替案: 特になし
- 影響: RT-04, RT-05, RT-09 および既存の compensation failure テストが完全パス。
- 可逆性: 高
- 制約: 仕様書で要求
- ユーザー確認: 不要

### D-005 永続化キュー復元時（deserialize）の effects 保持と正規化

- 種別: 永続化整合性
- タイミング: 実装中
- 参照元に書かれていたこと: VS Code 再起動時のキュー状態復元と不変条件保持 (INV-14)。
- 参照元に書かれていなかったこと: `normalizeTicketUpdate` で `effects` が空配列にリセットされてしまう経路の存在。
- 判断: `normalizeTicketUpdate` において、`effects` 内に `child_create`（`committed`, `commit_unknown`, `compensation_started`, `compensation_unknown`）が存在する場合は `promoteTicketIntent` による `effects: []` クリアを行わず、既存エフェクトを完全に保持して復元する。
- 理由: 再起動後にコミット済み子チケットが消去されて二重作成や孤立が発生するのを防ぐため。
- 代替案: 特になし
- 影響: 再起動・クラッシュ復元テストが完全パス。
- 可逆性: 高
- 制約: 仕様書で要求
- ユーザー確認: 不要

## 変更・逸脱

仕様書からの逸脱はなし。全不変条件（INV-01 〜 INV-26）を充足。

## 妥協点と残課題

妥協点および残課題はなし。

- 既存の全 908 件のテスト + 新規 Failure-First テスト 10 件 = **全 918 件がすべて PASS**。
- TypeScript strict コンパイル エラー 0 件。
- ESLint エラー 0 件。
- Webpack production bundle (`pnpm run package`) 正常生成。

## 検証結果

- `pnpm run compile-tests`: 成功 (0 errors)
- `pnpm run compile`: 成功 (0 errors)
- `pnpm run lint`: 成功 (0 errors)
- `pnpm test`: 成功 (**918 passing**, 0 failing)
- `pnpm run package`: 成功 (production bundle emitted)

