# Research: メタデータ先頭配置

## Decision 1: 旧形式の保存方針

- Decision: 読み込んだ形式を保持して保存する（旧形式は旧形式のまま）
- Rationale: 既存データの互換性と差分の最小化を優先する
- Alternatives considered: 保存時に新形式へ変換

## Decision 2: メタデータの先頭定義

- Decision: 空行/コメントを含めず、ファイル先頭に配置する
- Rationale: 解析ルールを単純化し、曖昧さをなくす
- Alternatives considered: 先頭空行やコメントを許容

## Decision 3: 本文の空行扱い

- Decision: 本文の空行は保持する（正規化しない）
- Rationale: 既存の書式を崩さないため
- Alternatives considered: 連続空行の正規化

## Decision 4: 旧形式でメタデータなしの場合

- Decision: メタデータを追加せず、そのまま保存する
- Rationale: 形式保持の方針に一致する
- Alternatives considered: 空のメタデータブロックを追加

## Decision 5: 件名の書式

- Decision: `# ` で始まる1行のみを件名として扱う
- Rationale: 既存仕様に合わせ、誤検出を避ける
- Alternatives considered: 複数レベルの見出しを件名扱い

## Reference Memo

- 現在の本文生成/解析は `src/views/ticketEditorContent.ts` に集約されている

## Regression Notes

- 旧形式（件名先頭）の再構成で並び順が変わらないことを重点確認する
