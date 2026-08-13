# Persisted Ticket Sync Lifecycle Normalization

日付: 2026-08-10
ステータス: 実装済み
プロジェクトルート: `/home/glorydays/projects/src/ts/vs-redmine-client`

## 依頼内容

添付仕様に従い、旧形式の既存チケット更新キューを永続化境界で canonical runtime lifecycle operation に正規化する。semantic CAS は変更せず、復元・スコープ移行・同期の互換性をテストで証明する。

## 背景

`src/views/offlineSyncStore.ts` の `deserializeQueue` は New ticket にのみ `operationId ?? queueId` を補完し、Existing ticket は revision と phase だけを補完している。`TicketSyncService` は Existing ticket の CAS expectation に `operationId ?? \`ticket:${ticketId}\`` を用いるため、旧 persisted entry は最初の `begin_preparation` transition で一致しない。

## 調査結果

- `deserializeQueue` は scoped storage、legacy root storage、restart recovery の全てで使用される。
- `initializeOfflineSyncStore` は root storage から scoped storage へ移行する際、現在の runtime queue を既存の persistence lane で保存する。
- `TicketSyncService.updateOrReconcileAtScope` は queued entry に `begin_preparation` を実行し、strict lifecycle expectation を渡す。
- `offlineSyncStore.test.ts` は legacy migration と restart recovery を、`ticketSyncService.test.ts` は durable lifecycle を既に検証している。

## 判断

- persistence boundary に Existing/New それぞれの identity、revision、phase を完成させる小さな normalizer を置く。
- CAS 側の fallback/wildcard は追加しない。scope migration が `serializeQueue` を使うため、canonicalized snapshot が同じ persistence lane で保存される。

## 実装計画

1. 旧形式 Existing/New entry の load、scope migration、restart semantics を固定するストアテストを追加する。
2. `deserializeQueue` を共通 normalizer 経由にして、Existing の missing `operationId` を `ticket:<ticketId>` に補完する。
3. legacy Existing entry が semantic lifecycle を通り PUT 1 回で完了するサービス統合テストを追加する。
4. 対象テスト、lint、compile、全テストを実行する。

## リスクと対策

- リスク: restart recovery の `preparing + nextIntent` promotion が壊れる。
  対策: normalizer 内で既存 promotion 関数を維持し、既存テストを拡張する。
- リスク: scope migration が追加 write を発生させる。
  対策: 通常 load では保存せず、既存 migration lane のみを使う。

## 検証方法

- `pnpm test -- --grep "offlineSyncStore|TicketSyncService durable lifecycle"`
- `pnpm run lint`
- `pnpm run compile`
- `pnpm test`

## 結果

`deserializeQueue` に Existing/New の canonical normalizer を導入し、Existing ticket の欠落 `operationId` を `ticket:<ticketId>` で補完した。legacy root/scoped load、明示 identity 保持、および実同期の回帰テストを追加し、`pnpm run test:unsafe`（compile-tests、webpack、lint、VS Code extension suite）で 830 passing を確認した。
