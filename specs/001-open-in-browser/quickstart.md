# Quickstart: 一覧行のブラウザ表示アイコン追加

## Preconditions
- TodoEx extension installed in VS Code.
- Redmine base URL configured.

## Manual Verification
1. Open the Activity Bar project list and click the browser icon on the right side of a project row.
2. Confirm the project page opens in the default browser.
3. Open the Activity Bar ticket list and click the browser icon on the right side of a ticket row.
4. Confirm the ticket page opens in the default browser.
5. Open the Activity Bar comment list and click the browser icon on the right side of a comment row.
6. Confirm the browser opens `issues/<ticketId>#note-<commentId>`.

## Error Handling
- If URL generation fails, a user-facing error appears and the browser is not opened.
- If the browser fails to launch, a user-facing error appears.

## Automated Tests
- Unit tests cover URL generation for project, ticket, and comment anchors.
- Unit tests cover failure handling for missing identifiers and browser launch errors.
