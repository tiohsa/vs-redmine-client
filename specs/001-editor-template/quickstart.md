# Quickstart: 新規作成エディタのテンプレート設定

## Preconditions
- TodoEx extension installed in VS Code.
- A template file exists at the configured absolute path.

## Manual Verification
1. Set the template file path in settings to an absolute path.
2. Open a new ticket editor and confirm the template content (metadata + body) is prefilled.
3. Update the template file content and open another new ticket editor to confirm the new content appears.
4. Open an existing ticket editor and confirm the template is not applied.
5. Confirm the template content overrides any existing default editor values.

## Error Handling
- If the template file is missing or invalid, a user-facing error appears and the new editor opens empty.

## Automated Tests
- Unit tests cover reading the template file, applying metadata + body, and skipping template for existing ticket edits.
