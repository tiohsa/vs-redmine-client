# todoex Development Guidelines

Auto-generated from all feature plans. Last updated: 2025-12-26
日本語で回答する

## Active Technologies
- N/A (Redmine is the system of record) (001-project-list-sidebar)
- N/A (in-memory editor mapping and draft state) (001-ticket-editor-pinning)
- In-memory ticket draft state (no persistent storage changes) (001-editor-save-sync)
- N/A (filenames computed from identifiers; no new persistence) (001-stable-editor-filename)
- N/A (in-memory state only) (001-activitybar-view)
- N/A (no new persistence) (001-add-ticket-icon)
- TypeScript 5.9 + VS Code Extension API, webpack, @vscode/test-cli, ESLint (001-add-settings-panel)
- In-memory state only (no persistence changes) (001-add-settings-panel)
- なし（下書き/表示はインメモリ） (001-show-saved-editor)
- TypeScript 5.9 + VS Code Extension API, webpack 5, @vscode/test-cli, ESLint (001-ticket-metadata-editor)
- N/A（インメモリのみ） (001-ticket-metadata-editor)
- N/A（永続化変更なし、インメモリのみ） (001-iconize-view-buttons)
- インメモリ（永続化なし） (001-editor-default-value)
- N/A (インメモリのみ、永続化変更なし) (001-children-ticket-create)
- VS Code workspace storage (ワークスペース内で永続保持) (001-tree-expand-collapse)
- N/A (in-memory) (001-metadata-before-subject)
- N/A (in-memory only) (001-add-child-ticket-icon)
- N/A (local file system only) (001-fix-editor-path)
- N/A (static asset update) (001-activitybar-icon)
- File-based template content from an absolute path (settings-controlled) (001-editor-template)

- TypeScript 5.9 + VS Code Extension API, webpack, @vscode/test-cli (001-redmine-ticket-workflow)

## Project Structure

```text
src/
tests/
```

## Commands

npm test && npm run lint

## Code Style

TypeScript 5.9: Follow standard conventions

## Recent Changes
- 001-editor-template: Added TypeScript 5.9 + VS Code Extension API, webpack 5, @vscode/test-cli, ESLint
- 001-activitybar-icon: Added TypeScript 5.9 + VS Code Extension API, webpack 5, @vscode/test-cli, ESLint
- 001-fix-editor-path: Added TypeScript 5.9 + VS Code Extension API, webpack 5, @vscode/test-cli, ESLint


<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
