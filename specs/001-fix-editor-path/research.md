# Research: 編集ファイルパス固定設定

## Decision 1: 設定値の形式

- Decision: 保存先はディレクトリパスのみ指定する
- Rationale: 既存のファイル名規則を維持できる
- Alternatives considered: フルファイルパス指定、テンプレート指定

## Decision 2: パスの解釈

- Decision: OSの絶対パスとして扱う
- Rationale: パス解釈の一貫性を保ち、曖昧さを排除する
- Alternatives considered: 相対パス、相対/絶対両対応

## Decision 3: 無効なパスの扱い

- Decision: エラー通知して従来の保存場所にフォールバックする
- Rationale: 問題を通知しつつ編集を継続できる
- Alternatives considered: 中断、無通知フォールバック
