# ticketSync

## Purpose
Provide ticket editor save, queue, metadata, and remote-content helpers used by the synchronization workflow.

## File Index
- `index.ts`: Re-exports ticket synchronization helpers and types.
- `ticketChangeDetector.ts`: Detects changes and safe queued updates.
- `ticketChildCreateSync.ts`: Creates and deduplicates child tickets.
- `ticketCreateSync.ts`: Handles new ticket draft synchronization.
- `ticketEditorRewrite.ts`: Rewrites and renames a newly synchronized editor.
- `ticketImageUploadSync.ts`: Summarizes image uploads and handles failures.
- `ticketMetadataResolver.ts`: Computes and resolves metadata changes.
- `ticketQueueSync.ts`: Validates and queues ticket drafts.
- `ticketRemoteContent.ts`: Converts remote tickets to editor content.
- `ticketSyncDeps.ts`: Supplies default remote dependencies.
- `ticketSyncResult.ts`: Builds save results and maps remote errors.
- `ticketUpdateSync.ts`: Synchronizes and reloads existing ticket drafts.
- `types.ts`: Defines ticket save, create, and reload dependencies.

## Local Rules & Conventions
- Keep queue preparation, remote content conversion, and editor rewriting in their dedicated modules.
- Add replaceable remote collaborators to the dependency types and defaults together.
- Export shared helpers through `index.ts` and preserve the application coordinator's lifecycle when connecting them.
