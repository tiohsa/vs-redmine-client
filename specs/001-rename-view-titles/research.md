# Research

## Decision: TypeScript 5.9 + VS Code Extension API
**Rationale**: 既存拡張の標準スタックであり、表示名変更に追加の技術選定は不要。  
**Alternatives considered**: 追加のフレームワーク導入（不要のため不採用）。

## Decision: ビュータイトルは短い名称に統一
**Rationale**: サイドバーの視認性を高め、一覧の可読性を改善するため。  
**Alternatives considered**: 旧名称の維持（長く視認性が下がるため不採用）。

## Decision: テストは@vscode/test-cliのユニットテスト
**Rationale**: 既存のテスト基盤を利用して変更箇所の検証を行えるため。  
**Alternatives considered**: 手動確認のみ（回帰防止の観点で不採用）。
