# Research: チケットメタデータ表示・更新

## Decision 1: 技術スタックの維持
- Decision: 既存の TypeScript 5.9 + VS Code Extension API + webpack + @vscode/test-cli を継続利用する
- Rationale: 既存の開発フローと整合し、追加の依存や設定変更が不要
- Alternatives considered: 新規ツール導入（未採用、要件に不要）

## Decision 2: メタデータの表現形式
- Decision: YAML の `issue` ブロックのみ許可し、他のネスト/配列は不正とする
- Rationale: 更新対象の項目を一意にし、検証・テストの範囲を明確にする
- Alternatives considered: YAML の自由構造（未採用、仕様逸脱の余地が大きい）

## Decision 3: 値の表現
- Decision: `tracker`/`priority`/`status` は表示名（文字列）で指定する
- Rationale: エディタでの可読性が高く、入力のハードルが低い
- Alternatives considered: ID指定（未採用、利用者負担が高い）

## Decision 4: 期日フォーマット
- Decision: `due_date` は `YYYY-MM-DD` のみ許可し、未指定（空）も許容する
- Rationale: 解釈の揺れを避け、空値で未設定を明示できる
- Alternatives considered: 任意文字列（未採用、検証が曖昧になる）
