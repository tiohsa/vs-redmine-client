# Redmine Client の開発者向け仕様

現行の機能仕様と変更時に守る条件は、以下の文書を正本とします。利用手順は [日本語 README](../README.ja.md)、作業ルールは [AGENTS.md](../AGENTS.md)、公開するコマンド・ビュー・設定の定義は [package.json](../package.json) を参照してください。

| 機能 | 仕様 |
| --- | --- |
| 接続設定と認証 | [接続先と API キー](features/connection.md) |
| Dashboard | [プロジェクト選択・一覧・検索・表示設定](features/dashboard.md) |
| チケット | [作成・Markdown 編集・エディタ既定値](features/tickets.md) |
| コメント | [閲覧・追加・編集](features/comments.md) |
| 画像と添付 | [Markdown 変換・アップロード・永続スプール](features/attachments.md) |
| 保存と同期 | [未同期キュー・同期ライフサイクル](features/offline-sync.md) |
| 障害復旧 | [競合・結果不明・破棄と中止](features/sync-recovery.md) |
| 開発と検証 | [実行境界・確認方法](development.md) |

動作を変更する際は、該当する正本と関連テストを同じ変更で更新してください。利用者の操作手順に影響する場合は README と [検証マップ](../verification/feature-map.json) も更新してください。生成した実行レポートは `docs/reports/` に出力できます。

実装の整理は [リファクタリング計画](refactoring-plan.md) を参照してください。
