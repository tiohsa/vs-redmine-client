# utils

## Purpose

Provides shared validation, transformation, and formatting for Markdown, attachment files, Redmine URLs, and failures. Also owns small VS Code notification and logging adapters.

## File Index

- `commentValidation.ts`: Checks empty and overlong comment content and provides length guidance.
- `editorBaseDir.ts`: Resolves an editor's base directory using its URI, extension settings, and workspace folders.
- `fileHash.ts`: Computes SHA-256 and byte size for files and buffers.
- `markdownImageLinks.ts`: Extracts Markdown image destinations and replaces links at their original offsets.
- `markdownImageUpload.ts`: Resolves and validates referenced local images, uploads them, and rewrites successful links.
- `markdownImageValidation.ts`: Checks supported image extensions, file accessibility, and size limits.
- `mermaid.ts`: Converts fenced Mermaid blocks to Redmine macro syntax.
- `notesHash.ts`: Computes a stable hash for comment notes.
- `notifications.ts`: Wraps VS Code message presentation.
- `redmineErrors.ts`: Classifies Redmine failures, retry disposition, and user-facing messages.
- `redmineLogger.ts`: Writes structured operation records to the extension's output channel.
- `redmineUrls.ts`: Builds browser URLs for projects, tickets, and comment anchors.
- `threeWayMerge.ts`: Merges local and remote line edits against a base and marks conflicting ranges.

## Local Rules & Conventions

- Keep image link parsing and replacement in `markdownImageLinks.ts`. Apply replacements from the end of the document to preserve earlier offsets.
- Preserve both lexical and real-path checks when resolving relative image paths, including the handling of missing paths and symlink targets.
- Keep validation and preparation reusable by coordinating callers. Apply document rewrites only to links backed by successful uploads.
- Keep error disposition separate from retry execution. Classify failures here and leave recovery decisions to the synchronization layer.
