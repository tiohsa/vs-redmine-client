# Quickstart: チケットメタデータ表示・更新

## Prerequisites

- Node.js + pnpm
- VS Code 1.107+

## Local Development

1. /home/glorydays/projects/src/ts/todoex で依存関係を準備
   - `pnpm install`
2. 拡張をビルド
   - `pnpm run compile`
3. テストを実行
   - `pnpm test`

## Notes

- メタデータはエディタ内の `---` 区間に表示される
- YAML 形式は `specs/001-ticket-metadata-editor/spec.md` の定義に従う
- 形式不備や必須項目の欠落がある場合、保存は失敗として通知される
