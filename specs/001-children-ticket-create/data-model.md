# Data Model: childrenメタデータによる子チケット自動登録

## Entities

### Ticket

- **Description**: 作成対象の課題。親子関係と件名を持つ。
- **Fields**:
  - `id`: チケット識別子
  - `subject`: 件名
  - `parentId`: 親チケット識別子（任意）
  - `childIds`: 子チケット識別子の一覧

### TicketMetadata

- **Description**: チケット作成時に付与できる補助情報。
- **Fields**:
  - `children`: 子チケット件名の一覧（文字列配列）

## Relationships

- 親チケットは 0..* の子チケットを持つ
- 子チケットは 1 件の親チケットに紐付く

## Validation Rules

- `children` は YAML 配列形式のみ有効
- `children` の各要素は空白除去後に 1 文字以上
- `children` 件数は最大 50 件
- `children` に空行/空白のみ/形式不正が含まれる場合、親子ともに作成しない
- 子チケット作成で 1 件でも失敗する場合、親子ともに作成しない
- `children` の重複件名は許可される（重複分も作成）
