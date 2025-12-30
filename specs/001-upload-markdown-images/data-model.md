# Data Model: Markdown画像リンクの自動アップロード

## Ticket

- Fields: id, subject, projectId
- Relationships: Ticket has many Comments and Attachments.

## Comment

- Fields: id, ticketId, authorId, body, createdAt
- Relationships: Comment belongs to Ticket and can reference Attachments.

## Markdown Image Reference

- Fields: originalText, localPath, resolvedUrl
- Rules: localPath must exist; external URLs are not modified.

## Image Asset

- Fields: filename, byteSize, mimeType, uploadToken, uploadedUrl
- Rules: mimeType must be PNG/JPEG/GIF/WebP; byteSize <= 10MB.

## Upload Result

- Fields: localPath, success, failureReason
- Rules: failures are reported while preserving saved content.
