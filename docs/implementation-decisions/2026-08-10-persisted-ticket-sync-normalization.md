# Persisted Ticket Sync Lifecycle Normalization 実装判断ログ

日付: 2026-08-10
ステータス: 完了
プロジェクトルート: `/home/glorydays/projects/src/ts/vs-redmine-client`
参照元: `Ticket Sync Persisted Queue Compatibility / Semantic Lifecycle Normalization 変更仕様書`（添付ファイル）
実装対象: `src/views/offlineSyncStore.ts` の persisted queue load normalization と関連テスト

## 依頼と参照元の要約

旧形式の Existing ticket persisted queue に lifecycle identity を補完し、load、restart、scope migration、Sync One/All で strict semantic lifecycle を成立させる。semantic CAS を緩めず、互換性を統合テストで証明する。

## 記録方針

このファイルには、参照元に明記されていなかった実装中の判断、変更、妥協点、仕様解釈、未解決事項、検証上の制約を記録する。

## 判断一覧

### D-001 既存の restart promotion 関数を normalizer から再利用する

- 種別: 解釈
- タイミング: 実装前
- 参照元に書かれていたこと: load boundary で identity、revision、phase、restart semantics を canonical 化する。
- 参照元に書かれていなかったこと: helper の分割方法。
- 判断: `promoteTicketIntent` と `promoteNewTicketIntent` は維持し、identity/revision/phase の補完をそれらの前に一元化する。
- 理由: 既存の restart recovery の挙動を複製せず、`queued => nextIntent undefined` を同一経路で維持できる。
- 代替案: promotion まで含めて新規 helper に再実装する。
- 影響: 変更範囲を persistence boundary に限定し、既存 recovery contract を保持する。
- 可逆性: 高。helper の抽出のみで、外部契約は変わらない。
- 制約: 任意判断。
- ユーザー確認: 不要。

### D-002 tuple key を legacy Existing identity の入力に使う

- 種別: 解釈
- タイミング: 実装中
- 参照元に書かれていたこと: legacy Existing identity は `ticket:<ticketId>` とする。
- 参照元に書かれていなかったこと: persisted tuple の key と value 内の `ticketId` が不一致の場合の identity source。
- 判断: `deserializeQueue` が既に妥当性確認して Map key として採用する tuple key を identity の入力にした。
- 理由: queue の lookup と lifecycle transition は tuple key を基準に行われるため、同じ key を使うことで Store/Service の identity が一致する。
- 代替案: value 内の `ticketId` を使う。
- 影響: 合法的な legacy data の identity は deterministic になり、CAS を変更しない。
- 可逆性: 高。normalizer 内の入力選択のみ。
- 制約: 任意判断。
- ユーザー確認: 不要。

## 変更・逸脱

参照元からの逸脱なし。通常の scoped load では追加の Memento write を導入していない。root-to-scope migration は既存の `schedulePersist` lane を使用し、normalizer 済み snapshot を保存する。

## 妥協点と残課題

VS Code 1.107 の実ランタイム、および実 Redmine 6.1 に対する timeout/restart E2E は本作業環境では未実施。既存の mock integration suite により lifecycle と PUT 回数を検証した。

## 検証と制約

- 実行した検証: CodeGraph により `deserializeQueue` が全 load path の共通境界であり、`TicketSyncService` が strict expectation を使うことを確認した。`pnpm run test:unsafe` により compile-tests、webpack、ESLint、VS Code extension suite を実行し、830 passing を確認した。
- 実行できなかった検証: 通常の `pnpm test` は Electron sandbox の `Operation not permitted` で test host 起動前に停止したため、プロジェクト標準の no-sandbox script を使用した。実 Redmine/VS Code 1.107 E2E は未実行。

## 結果

Existing/New persisted queue を runtime lifecycle operation へ canonical 化した。legacy Existing の identity 欠落を load boundary で解消し、strict CAS、scope isolation、restart recovery を変更せずに同期完走をテストで確認した。
