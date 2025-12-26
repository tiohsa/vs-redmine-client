# Quickstart: Redmine Ticket Workflow

## Prerequisites

- A Redmine 6.1 instance URL.
- A personal API key with access to target projects.

## Configure

1. Open the extension settings and provide your Redmine base URL.
2. Add your API key for authentication.
3. Select a target project in the sidebar.

## Browse Tickets

1. Load the ticket list for the project (latest 50 by default).
2. Toggle inclusion of child projects if needed.
3. Apply status and assignee filters (full option lists are available).
4. Select a ticket to open a read-only preview in the editor area.

## Create Ticket from Editor

1. Open or write content in the active editor.
2. Insert Mermaid code blocks where needed; they will be converted on submit.
3. Attach images via file selection or clipboard paste.
4. Submit to create a new ticket with the editor content as the description.

## Edit Existing Comments

1. Open a ticket and select one of your own comments from the comment list.
2. Edit the comment in the editor.
3. Save changes and confirm the updated comment appears in ticket history.

## Error Handling

- If a load, filter, preview, create, upload, or edit action fails, the
  extension provides a clear failure message and allows retry.
- Example: "Failed to load tickets (401). Check your API key and try again."
- Example: "Attachment upload failed. Verify the file exists and retry."
