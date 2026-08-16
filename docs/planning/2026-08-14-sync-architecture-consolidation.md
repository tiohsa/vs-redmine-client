# 同期アーキテクチャ統合・不変条件保証の実装計画

日付: 2026-08-14
ステータス: 計画中
プロジェクトルート: `/home/glorydays/projects/src/ts/vs-redmine-client`

## 依頼内容

`docs/issue-20260814-1.md` の内容と実コードを確認し、妥当であれば同期アーキテクチャの統合と変更を実行する。

## 背景

`vs-redmine-client` の同期処理には、すでに `remote_write_started`、`commit_unknown`、`reconciliation_pending`、`local_finalize_pending`、リビジョンフェンス、子チケットの Saga / compensation、接続スコープの分離などの耐障害機構が存在する。
しかし、これらが以下の複数箇所に分散している：
1. Ticket / NewTicket の同期は `TicketSyncService` が担当
2. Comment の同期は `SyncEngine` が独自に処理
3. Ctrl+S 保存（`saveSyncExecutor` / `ticketQueueSync`）では `offlineSyncMode`（auto/manual）に関わらずローカル保存のみで終了し、README の「auto は即時 Redmine 同期」仕様と乖離している
4. `createTicketFromEditor()` が Durable Sync 境界を通らず直接 `createIssue()` を呼び出している（C-04）
5. `offlineSyncStore.ts`（約2000行）に State Machine、永続化（Memento）、マイグレーション、キュー操作、CAS が集中している
6. `syncUnsyncedFile.ts` などの Command 層に recovery policy や phase 判定が漏れ出ている
7. `offlineSync.ts` 等に `@deprecated` の旧経路 fallback（`createTicketSyncService`）が残っている

## 調査結果

- `src/commands/createTicket.ts` は `createIssue()` を直接呼んでおり、`SyncOperation` や checkpoint を経由していないことを確認（C-04）。
- `src/views/ticketSync/ticketQueueSync.ts` の `saveTicketDraftLocally` は `offlineSyncMode` の判定を行わず `addOfflineTicketUpdate` でローカル保存して終了しており、README の記述と乖離していることを確認（C-03）。
- `src/app/syncEngine.ts` は Ticket のみ `TicketSyncService` に委譲し、Comment のライフサイクル（`syncComment`）を自前で実装していることを確認（C-02）。
- `src/views/offlineSyncStore.ts` は 1947行あり、型定義、状態遷移、永続化、マイグレーションが密結合していることを確認（C-05）。
- `src/commands/syncUnsyncedFile.ts` が `phase` や種別ごとの recovery 条件を個別に判定していることを確認（C-07）。
- 現状のテスト（885件）は全件成功しているため、既存の耐障害性・永続化互換性を100%維持しながら、段階的にリファクタリング・統合する必要がある。

## 判断

- **方針採択**: `docs/issue-20260814-1.md` で提案された「案D: 状態ライフサイクル全体の統合」を採用する。
- **5つの責務境界の分離**:
  1. `SyncOperation`: 共通の persisted aggregate 型
  2. `SyncStateMachine`: 純粋な状態遷移ルール（generic states & transitions）
  3. `SyncCoordinator`: 単一の同期オーケストレーター（enqueue, sync, resolveCommitUnknown, single-flight, CAS）
  4. `OperationHandler`: Ticket Create / Ticket Update / Comment Create / Comment Update のドメイン処理
  5. `SyncOperationRepository`: Memento への永続化、CAS更新、マイグレーション、クエリ
- **Entry Point の統一**:
  - Editor（Ctrl+S）、Command Palette、Dashboard、Unsynced View からの write はすべて Intent 境界を通り Coordinator に委譲する。
  - `offlineSyncMode`（auto / manual）は enqueue 後の実行ポリシーとして処理（auto なら即時同期、manual ならキュー保存のみ。New Ticket draft は暫定仕様として queueOnly）。
  - `createTicketFromEditor` を Intent 経由に修正。
- **既存の不変条件（INV-01 〜 INV-16）の厳格維持**:
  - Remote write 前の checkpoint（`remote_write_started`）
  - `commit_unknown` 時の自動再送禁止と明示的 recovery
  - プロセス再起動時の `started` → `commit_unknown` 正規化
  - 接続スコープの完全分離
  - リビジョンフェンス / CAS
  - Single-flight（並行同期時の多重 write 防止）
  - 後続保存（`nextIntent`）の保護と昇格
  - 子チケットの Saga と compensation
  - 既存永続データ（v1/v2/v3）の復元互換

## 実装計画

1. **Phase 1: 再現・境界テストの追加**
   - Ctrl+S auto モードでの即時同期テスト（RT-01）
   - `createTicketFromEditor` が Durable Sync 境界を通るテスト（RT-03）
   - Ticket / Comment の状態遷移パリティ・静的境界ガードテスト
2. **Phase 2: Pure Sync State Model / State Machine の作成**
   - generic state / action / transition テーブルを pure module として定義
   - 遷移マトリクステスト
3. **Phase 3: Sync Operation Repository の分離**
   - `offlineSyncStore` から Memento 永続化、CAS、マイグレーション（v1/v2/v3/v4）、クエリを分離
   - 既存の復元互換性テストの完全パス確認
4. **Phase 4: Sync Coordinator & Operation Handlers の実装**
   - Ticket Update, Ticket Create, Comment Update, Comment Create の各 Handler 実装
   - 共通 SyncCoordinator の実装（single-flight, CAS, state transition, retry/reconciliation）
5. **Phase 5: Entry Point の統合 & 直接呼出の撤去**
   - `performSyncOnSave` / `saveSyncExecutor` で `offlineSyncMode` に基づく auto 同期
   - `createTicketFromEditor` を Coordinator 経由に変更
   - `syncToRedmine`、`syncUnsyncedFile`、Dashboard、Comments をすべて Coordinator に接続
   - `@deprecated` な旧経路 fallback の削除
6. **Phase 6: 全テスト検証 & ドキュメント更新**
   - ユニットテスト、統合テスト、Extension Host テストの実行（`pnpm test`, `pnpm run lint`）
   - `AGENTS.md`, `README.md`, `README.ja.md` の更新

## リスクと対策

- リスク: 既存の永続化データ（workspaceState / Memento に保存されたキュー）のマイグレーション不整合によるデータ損失
  対策: v1/v2/v3 の各ゴールデンフィクスチャテストを網羅し、`remote_write_started` 等の uncertain 状態が安全に復元されることを検証。
- リスク: エディタ保存時の競合・suppression・debounce との相互作用による二重実行や画面フリーズ
  対策: save suppression と debounce を維持しつつ、Coordinator の single-flight 機構で同一操作の多重飛行を防止。
- リスク: 子チケット作成や添付ファイルアップロードを含む複雑な Saga のリグレッション
  対策: 既存の 50 children ledger テストや compensation failure テストをそのまま新 Handler に引き継ぎ検証。

## 検証方法

- `pnpm run compile-tests`
- `pnpm run lint`
- `pnpm test` (全テストスイートの実行)
- 新規追加した再現テスト（RT-01, RT-03, 状態パリティ）のパス確認

## 結果

実装待ち。
