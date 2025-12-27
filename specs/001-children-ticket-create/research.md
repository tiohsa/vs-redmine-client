# Research: childrenメタデータによる子チケット自動登録

## Decision 1: children の入力形式

- **Decision**: `children` はハイフン付きの箇条書き（YAML配列形式）のみ有効とする
- **Rationale**: 入力形式を単一にすることで検証基準が明確になり、テスト設計とユーザー説明が簡潔になるため
- **Alternatives considered**: カンマ区切り1行 / 複数形式の併用

## Decision 2: 失敗時の原子性

- **Decision**: 子チケット作成で1件でも失敗した場合、親も子も作成しない
- **Rationale**: 親子の整合性を保ち、部分作成による運用混乱を防ぐため
- **Alternatives considered**: 親のみ作成 / 成功分のみ作成

## Decision 3: children 件数上限

- **Decision**: `children` の件数上限は 50 件
- **Rationale**: 想定外の大量作成を防ぎ、作成体験の安定性を保つため
- **Alternatives considered**: 上限なし / 超過分切り捨て
