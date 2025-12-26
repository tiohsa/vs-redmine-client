# Research: Activity Bar専用一覧ビュー

## Decision 1: 専用ビューの構成
- **Decision**: Activity Barに専用ビューを追加し、エクスプローラーと同じ階層・並びの一覧を表示する。
- **Rationale**: 既存の利用習慣を維持しつつ、専用の入口で同等の情報を提供できる。
- **Alternatives considered**: エクスプローラーのみ継続、フラットな一覧表示、簡易一覧のみ。

## Decision 2: 更新タイミング
- **Decision**: 専用画面がフォーカスされたタイミングで一覧を自動更新する。
- **Rationale**: 最新性を確保しつつ、常時更新による負荷を避けられる。
- **Alternatives considered**: 手動更新のみ、常時バックグラウンド更新。

## Decision 3: 空状態の表示粒度
- **Decision**: プロジェクト・チケット・コメント各一覧ごとに空状態メッセージを出し分ける。
- **Rationale**: どの一覧にデータがないかが明確になり、次の行動が取りやすい。
- **Alternatives considered**: 共通メッセージのみ、空状態は何も表示しない。

## Decision 4: エラー表示の詳細度
- **Decision**: 一覧取得失敗時に開発者向け詳細を含むエラーメッセージを表示する。
- **Rationale**: 開発・検証時の原因特定が容易になる。
- **Alternatives considered**: 一般的なユーザー向けメッセージのみ、詳細コードのみ。

## Decision 5: 表示件数の上限
- **Decision**: 2,000件までの一覧表示を著しく遅延なく提供する。
- **Rationale**: 現実的な規模での運用を想定し、パフォーマンス検証可能な上限を設定する。
- **Alternatives considered**: 500件まで、10,000件まで。
