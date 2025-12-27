# Data Model: 親子関係ツリー表示

## Project

- Fields: id, name, identifier, parentId, hasChildren
- Relationships: Project has many child Projects and many Tickets.
- Rules: parentIdが欠落している場合は最上位として扱う。

## Ticket

- Fields: id, subject, statusId, statusName, projectId, parentId, hasChildren
- Relationships: Ticket belongs to Project and may have child Tickets.
- Rules: parentIdが欠落している場合は最上位として扱う。

## Tree Node (View Model)

- Fields: nodeId, label, parentId, level, isExpanded
- Rules: 循環参照を検知した場合は該当ノードで展開を停止し警告対象とする。
