# views

## Purpose
Implement editor and tree presentation, draft state, and offline queue persistence for Redmine workflows.

## File Index
- `comment*.ts`: Comment views, draft state, content processing, conflict handling, save and sync helpers.
- `commentsView.ts`: Comment tree provider and permissions.
- `conflict*.ts`: Shared conflict diff, editor, UI, and resolver entry points.
- `draftPersistence.ts`: Draft storage adapters.
- `editor*.ts`: Editor defaults, document rewriting, and filename helpers.
- `markdownTicket*.ts`: Markdown heading ticket creation and updates.
- `newTicketDraftStore.ts`: New ticket draft storage.
- `offlineSync*.ts`: Scoped queue storage, codecs, operations, lifecycle, effects, and presentation.
- `projectListSettings.ts`, `projectsView.ts`: Project list settings and tree provider.
- `redmineTicketFrontmatterTemplate.ts`: Builds ticket frontmatter templates.
- `reloadSafety.ts`: Checks and confirms potentially destructive reloads.
- `saveSyncSuppression.ts`: Suppresses save-triggered sync during controlled edits.
- `saveUpload*.ts`: Shared upload result types and notifications.
- `selectionHighlight.ts`: Selection highlight icons.
- `ticket*.ts`: Ticket editor, metadata, drafts, conflicts, previews, save helpers, and list state.
- `tree*.ts`: Tree construction, expansion state, types, and warnings.
- `unsyncedFilesView.ts`: Unsynced file tree provider.
- `untitledPath.ts`: Generates unique untitled paths.
- `view*.ts`: Shared view context, focus refresh, IDs, limits, and display state.

## Local Rules & Conventions
- Route queue changes through the `offlineSyncStore.ts` facade and its specialized queue modules.
- Keep editor content and metadata parsing separate from presentation and persistence.
- Use the existing conflict and save result helpers when connecting editor actions to synchronization.
