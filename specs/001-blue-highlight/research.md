# Research

## Decision: TypeScript 5.9 + VS Code Extension API
**Rationale**: 既存拡張の標準スタックであり、ハイライト色変更に追加の技術選定は不要。  
**Alternatives considered**: 追加のフレームワーク導入（不要のため不採用）。

## Decision: 選択ハイライトは同一の青系カラーに統一
**Rationale**: 選択状態の視認性を高め、区別しやすくするため。  
**Alternatives considered**: 種別ごとに色を分ける（視認性が分散するため不採用）。

## Decision: テストは@vscode/test-cliのユニットテスト
**Rationale**: 既存のテスト基盤を利用して変更箇所の検証を行えるため。  
**Alternatives considered**: 手動確認のみ（回帰防止の観点で不採用）。
