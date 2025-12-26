# Quickstart: Add Ticket Comment

## Prerequisites

- A Redmine 6.1 instance URL.
- A personal API key with access to target projects.

## Configure

1. Open the extension settings and provide your Redmine base URL.
2. Add your API key for authentication.

## Add Comment

1. Select a ticket in the "Redmine Tickets" view.
2. Run the "Redmine: Add Comment" command.
3. Enter a comment (up to 20000 characters) and submit.
4. The input stays open and clears after successful submission.
5. If submission fails, the input is preserved for retry.

## Error Handling

- Empty or whitespace-only comments are blocked with a message.
- Submission failures show a clear error and allow retry.
