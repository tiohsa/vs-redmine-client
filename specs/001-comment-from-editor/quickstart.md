# Quickstart: Comment from Editor

## Prerequisites

- A Redmine 6.1 instance URL.
- A personal API key with access to target projects.

## Configure

1. Open the extension settings and provide your Redmine base URL.
2. Add your API key for authentication.

## Add Comment from Editor

1. Select a ticket in the "Redmine Tickets" view.
2. Ensure an editor is active with the comment text.
3. Run the "Redmine: Add Comment" command.
4. The editor content is posted as the comment.

## Edit Comment from Editor

1. Select one of your own comments in the "Redmine Comments" view.
2. Ensure an editor is active with the updated text.
3. Run the "Redmine: Edit Comment" command.
4. The editor content replaces the selected comment.

## Error Handling

- Empty or whitespace-only editor content is blocked with a message.
- Content over 20000 characters is rejected with guidance.
- Submission failures show a clear error and allow retry.
