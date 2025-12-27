# Data Model: 保存済み状態でのエディタ表示

## Entities

### チケット
- **Fields**: id, savedContent, updatedAt
- **Relationships**: コメント（1対多）
- **Validation**: savedContent は空でも許容、id は一意

### コメント
- **Fields**: id, ticketId, savedContent, updatedAt
- **Relationships**: チケットに属する（多対1）
- **Validation**: ticketId は既存チケットに紐づく

### 下書き
- **Fields**: id, targetType (ticket/comment), targetId, draftContent, createdAt
- **Relationships**: チケットまたはコメントに紐づく（1対1）
- **Validation**: targetType + targetId が一意

### エディタ表示
- **Fields**: targetType, targetId, displayContent, source (draft/saved), lastLoadedAt
- **Relationships**: 表示対象のチケット/コメントに紐づく
- **Validation**: source は draft または saved

## State Transitions

- **選択時**: 下書きがあれば displayContent = draftContent, source = draft
- **Reload成功時**: displayContent = savedContent, source = saved
- **Reload失敗時**: displayContent は変更しない

## Notes

- 永続化は行わず、下書きと表示はインメモリで管理する。
