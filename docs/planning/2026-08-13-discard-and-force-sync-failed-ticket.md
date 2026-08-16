# 同期失敗チケットの破棄と上書き同期

日付: 2026-08-13
ステータス: 実装済み
プロジェクトルート: `/home/glorydays/projects/src/ts/vs-redmine-client`

## 依頼内容

同期に失敗した既存チケットがダッシュボードから破棄できず、上書き同期もできない問題を解消する。

## 背景

未同期アイテムは `offlineSyncStore` の durable lifecycle で管理され、`unsyncedDashboardViewModel` が破棄・同期ボタンの可否を決める。既存チケットの同期結果不明・復旧待ち状態は `syncUnsyncedFile` と `TicketSyncService.resolveCommitUnknown` が明示的な再試行を担当する。

## 調査結果

- `reconciliation_pending` と `commit_unknown` のチケットは `canDiscard: false` になり、ダッシュボードの破棄ボタンが無効化される。
- `discardOfflineTicketUpdateAsync` も durable checkpoint を持つ操作を `recovery_required` として保持するため、確認済みの破棄操作でもローカルキューを消せない。
- `commit_unknown` の同期は既に明示確認付きの `Retry remote write` を提供するが、競合を検出した場合は再び結果不明扱いに戻り、通常の競合解決で使うローカル優先（上書き同期）へ進めない。

## 判断

- ダッシュボードでユーザーがモーダル確認した破棄は、lifecycle にかかわらずローカルの未同期キューを削除できるようにする。これはサーバー側データを削除せず、確認文言もその点を明示している。
- 上書き同期は、既存の競合解決と同じ「ローカル優先」を、失敗キューの同期経路でも明示的に選択できるようにする。結果不明のリモート書込みを自動再送しない安全規則は維持する。

## 実装計画

1. lifecycle checkpoint を持つ既存チケットを確認済みの破棄操作で削除可能にし、ビュー・ストアのテストを更新する。
2. 失敗キューで競合した既存チケットに、確認済みのローカル優先同期を実行する recovery transition を追加する。
3. 対象テスト、型チェック、lint を実行して確認する。

## リスクと対策

- リスク: 結果不明のリモート操作を自動的に再送して重複更新する。
  対策: 再送・上書きはいずれもユーザーのモーダル選択後だけに行い、自動同期では開始しない。
- リスク: 破棄がリモートチケットを削除すると誤解される。
  対策: 既存の確認文言を維持し、ローカルキューだけを削除する。

## 検証方法

- `offlineSyncStore` とダッシュボード view model のユニットテスト。
- `ticketSyncService` の競合 recovery テスト。
- `pnpm test`、`pnpm run lint`、`pnpm run compile`。

## 結果

- `unsyncedDashboardViewModel` が checkpoint を持つ既存チケットにも破棄操作を表示するようにした。
- `discardOfflineTicketUpdateAsync` は確認済みの既存チケットを lifecycle にかかわらずローカルキューから削除する。リモートチケットは変更しない。
- ダッシュボードの既存チケット同期で競合した場合、開いているチケットエディターの同期コマンドへ遷移し、既存の「Local Priority」選択で上書き同期できるようにした。
- `pnpm test`、`pnpm run compile`、`pnpm run lint` が成功した。
