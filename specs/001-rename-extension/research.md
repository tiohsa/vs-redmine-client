# Research

## Decision: TypeScript 5.9 + VS Code Extension API
**Rationale**: 既存拡張の標準スタックであり、表示名変更に追加の技術選定は不要。  
**Alternatives considered**: 追加のフレームワーク導入（不要のため不採用）。

## Decision: 主要なユーザー向け表示は全て名称を統一
**Rationale**: 表示箇所の取りこぼしによる混乱を防ぐため。  
**Alternatives considered**: Activity Barのみ変更（旧名称が残るため不採用）。

## Decision: テストは@vscode/test-cliのユニットテスト
**Rationale**: 既存のテスト基盤を利用して変更箇所の検証を行えるため。  
**Alternatives considered**: 手動確認のみ（回帰防止の観点で不採用）。
