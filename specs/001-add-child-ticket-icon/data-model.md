# Data Model: チケット一覧の子チケット追加アイコン

## Entities

### TicketListItem

- Represents: チケット一覧の表示行
- Fields:
  - ticketId (number): 親チケット識別子
  - subject (string): 件名
  - canCreateChild (boolean): 子チケット追加アイコンの表示可否

### ChildTicketDraft

- Represents: 新規チケット編集画面に渡す初期状態
- Fields:
  - parentId (number): 親チケットの数値ID
  - projectId (number): 親チケットと同じプロジェクトID

## Relationships

- TicketListItem.ticketId -> ChildTicketDraft.parentId (1:1)
- TicketListItem.projectId -> ChildTicketDraft.projectId (1:1)

## Validation Rules

- parentId は数値IDのみ許可する
- parentId が取得できない場合は作成フローを開始しない
