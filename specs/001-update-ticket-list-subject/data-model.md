# Data Model: チケット一覧件名更新

## Entities

### TicketListItem

- **Purpose**: チケット一覧に表示される行データ
- **Fields**:
  - `ticketId`: チケット識別子
  - `subject`: 一覧で表示する件名
- **Relationships**:
  - TicketListItem 1..1 → Ticket (識別子で参照)
- **Validation Rules**:
  - `subject` は空文字にならない

## State Transitions

- 保存成功時に該当 `ticketId` の `subject` を更新する
- 保存失敗時は `subject` を変更しない
