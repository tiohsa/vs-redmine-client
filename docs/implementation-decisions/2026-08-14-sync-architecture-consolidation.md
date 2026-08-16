# 同期アーキテクチャ統合 実装判断ログ

日付: 2026-08-14
ステータス: 記録中
プロジェクトルート: `/home/glorydays/projects/src/ts/vs-redmine-client`
参照元: `docs/issue-20260814-1.md`, `docs/planning/2026-08-14-sync-architecture-consolidation.md`
実装対象: 同期アーキテクチャ（`src/app/ticketSync/`, `src/app/syncEngine.ts`, `src/views/offlineSyncStore.ts`, `src/commands/`, `src/views/`）

## 依頼と参照元の要約

`docs/issue-20260814-1.md` に記載された問題（分散したオーケストレーター、Ctrl+S autoの動作乖離、`createTicketFromEditor`の直接Redmine呼出、`offlineSyncStore`の肥大化など）を解消し、すべての durable mutation を単一の Sync Coordinator・State Machine・Repository・Operation Handler 境界に統合する。

## 記録方針

このファイルには、参照元に明記されていなかった実装中の判断、変更、妥協点、仕様解釈、未解決事項、検証上の制約を記録する。

## 判断一覧

### D-001 New Ticket DraftのCtrl+S auto保存ポリシーの解釈

- 種別: 解釈 / 仕様ギャップ
- タイミング: 実装前
- 参照元に書かれていたこと: Existing Ticketのautoは即時Redmine更新、manualはキュー保存。New Ticket draftについてはREADMEの「保存時queue、明示同期時create」ワークフローを優先しqueueOnlyとする暫定仕様（Q-01）。
- 参照元に書かれていなかったこと: 新規チケットの下書き保存時の詳細挙動。
- 判断: Existing TicketおよびCommentの更新は `offlineSyncMode === "auto"` の場合に保存直後に即時同期を実行し、New Ticket Draftはauto/manual問わず保存時はキュー保存（queueOnly）とし、明示同期時（Sync One / Sync All / createTicketFromMarkdownHeader 等）にRedmine作成を実行する。
- 理由: 新規チケットは件名や本文、メタデータを編集中に誤って未完成のままRedmineに作成されることを防ぐ既存UX方針と合致するため。
- 代替案: New Ticketもautoで即時createIssueする（ユーザーが編集途中で勝手にチケットが作られるリスクがあるため不採用）。
- 影響: README記載の動作と完全に整合する。
- 可逆性: 高
- 制約: 任意判断
- ユーザー確認: 事後報告

### D-002 永続スキーマバージョン（v3維持かv4導入か）の判定

- 種別: 技術制約 / 仕様ギャップ
- タイミング: 実装前
- 参照元に書かれていたこと: v3表現のままsingle sourceを実現できるか評価し、可能ならversion bumpを不要とし、不可能な場合のみv4を導入する（Q-02）。
- 参照元に書かれていなかったこと: 具体的な型定義の互換性。
- 判断: 既存の `SyncOperation` envelope（`operationId`, `kind`, `phase`, `revision`, `connectionScope`, `effects`, `nextIntent` 等）を共通状態モデルの基礎として活かし、v1/v2/v3のマイグレーションをそのまま保持しつつ、内部のState MachineとRepositoryをpureに分離する。
- 理由: 不要な永続形式変更を避け、既存ユーザーのworkspaceState復元安全性を最大化するため。
- 代替案: 全面的なv4スキーマへの移行（移行リスクが高いため回避）。
- 影響: 永続化データの完全な下位互換性が保たれる。
- 可逆性: 高
- 制約: 任意判断
- ユーザー確認: 事後報告

## 変更・逸脱

現時点ではなし。

## 妥協点と残課題

現時点ではなし。

## 検証と制約

- 実行した検証:
  - 変更前ベースラインのテスト（885 passing）、lint、コンパイル確認。
- 実行できなかった検証:
  - 現時点ではなし。

## 結果

実装中。
