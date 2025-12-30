# Phase 1 Data Model: プロジェクト別テンプレート

## Entities

### Project
- **Fields**: projectId, name
- **Notes**: 表示名がテンプレート判別に使われる。

### Template
- **Fields**: fileName, content, lastUpdatedAt
- **Validation**: ファイル名にプロジェクト名の完全一致を含む必要がある（大文字小文字は無視）。

### DefaultTemplate
- **Fields**: fileName (固定名: default.md), content
- **Validation**: 常に利用可能であること。

## Relationships

- Project 1 → 0..1 Template (プロジェクト名の一致で解決)
- Project 1 → 1 DefaultTemplate (フォールバック)

## State Transitions

- Template: create → update
- DefaultTemplate: create → update
