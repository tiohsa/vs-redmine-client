# commands

## Purpose
Implement VS Code command interactions for ticket and comment editing, synchronization, and recovery.

## File Index
- `addComment.ts`: Adds a comment to an issue.
- `addCommentFromList.ts`: Starts a comment from a list selection.
- `commentPrompt.ts`: Collects comment input and attachments.
- `createChildTicketFromList.ts`: Starts a child ticket draft.
- `createTicket.ts`: Creates a ticket from an editor.
- `createTicketFromList.ts`: Opens a new ticket draft from a list.
- `createTicketFromMarkdownHeader.ts`: Creates a ticket from a Markdown heading.
- `editComment.ts`: Opens comment editing.
- `focusTicketEditor.ts`: Focuses a registered ticket editor.
- `insertRedmineTicketFrontmatter.ts`: Inserts ticket frontmatter.
- `offlineSync.ts`: Runs queued offline synchronization.
- `offlineSyncMode.ts`: Configures and exposes offline sync mode.
- `openCommentUpdateDraft.ts`: Opens or seeds a comment update draft.
- `openInBrowser.ts`: Opens Redmine resources in a browser.
- `reloadComment.ts`: Reloads a comment editor.
- `reloadTicket.ts`: Reloads a ticket editor.
- `syncToRedmine.ts`: Synchronizes an editor with Redmine.
- `syncUnsyncedFile.ts`: Synchronizes an unsynced file.
- `unsyncedLocalFinalize.ts`: Prompts for local finalization recovery.
- `unsyncedPrimaryRecovery.ts`: Prompts for uncertain primary write recovery.
- `unsyncedRecoveryPrompt.ts`: Provides shared recovery prompts.
- `unsyncedSecondaryRecovery.ts`: Prompts for secondary effect recovery.

## Local Rules & Conventions
- Register commands in the corresponding `../app/*CommandRegistrations.ts` module.
- Keep interactive prompts here and delegate synchronization and persistence to their existing services.
- Follow the existing dependency injection patterns when command behavior requires replaceable collaborators.
