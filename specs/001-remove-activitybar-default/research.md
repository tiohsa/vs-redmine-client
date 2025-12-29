# Research

## Decision: TypeScript 5.9 + VS Code Extension API
**Rationale**: 既存拡張の標準スタックであり、今回の変更はUI削除に限定されるため追加の技術選定が不要。  
**Alternatives considered**: 追加のUIフレームワーク導入（不要のため不採用）。

## Decision: 既定値はファイル定義のみを採用
**Rationale**: 仕様で設定場所を一本化し、Activity Barからの混乱や誤設定を防止するため。  
**Alternatives considered**: Activity Barでの閲覧のみ許可（UIの残存が混乱を招くため不採用）。

## Decision: テストは@vscode/test-cliのユニットテスト
**Rationale**: 行動変更の検証に既存のテスト基盤を利用できるため。  
**Alternatives considered**: E2Eのみで検証（変更範囲が小さく、ユニットで十分なため不採用）。
