# Research: 一覧行のブラウザ表示アイコン追加

## Decision
Use Activity Bar list item icons to trigger an open-in-browser command that builds Redmine URLs for projects, tickets, and comment anchors (`issues/<ticketId>#note-<commentId>`).

## Rationale
This aligns with existing Activity Bar usage and provides a fast path to Redmine details while keeping Explorer views unchanged.

## Alternatives considered
- Expose icons in Explorer lists (rejected: requirement explicitly limits to Activity Bar lists).
- Open comments without anchors (rejected: requirement specifies comment anchors).
