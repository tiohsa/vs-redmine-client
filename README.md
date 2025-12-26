# TodoEx

Manage Redmine 6.1 tickets directly inside VS Code. Browse project tickets,
preview details, create new tickets from editor content with attachments, and
edit your own comments without leaving the editor.

Japanese README: `README.ja.md`

## Features

- Sidebar ticket list with status/assignee filters
- Sidebar project list with selection highlight
- Child project inclusion toggle
- Read-only ticket preview in the editor
- Create tickets from active editor content
- Image attachments from file selection or clipboard data URI
- Mermaid block conversion for redmica_ui_extension (`{{mermaid ... }}`)
- Edit only your own ticket comments
- Comments list in a dedicated sidebar view

## Requirements

- Redmine 6.1 server
- Redmine API key with access to target projects

## Extension Settings

This extension contributes the following settings:

- `todoex.baseUrl`: Base URL of the Redmine instance (include http:// or https://)
- `todoex.apiKey`: Redmine API key
- `todoex.defaultProjectId`: Default project identifier or ID
- `todoex.includeChildProjects`: Include child projects in ticket list
- `todoex.ticketListLimit`: Default number of tickets to load per request

## Usage

1. Configure `todoex.baseUrl` (include http:// or https://) and `todoex.apiKey`.
2. Set `todoex.defaultProjectId` or use the command to select a project.
3. Browse tickets in the "Redmine Tickets" view.
4. Select a project in the "Redmine Projects" view to load tickets.
5. Select a ticket to preview details and load comments.
6. Use the "Redmine: Create Ticket from Editor" command to create a ticket.
7. Use the "Redmine: Edit Comment" command to update your own comments from
   the active editor content.

## Commands

- `Redmine: Refresh Projects`
- `Redmine: Refresh Tickets`
- `Redmine: Select Project`
- `Redmine: Toggle Child Projects`
- `Redmine: Open Ticket Preview`
- `Redmine: Create Ticket from Editor`
- `Redmine: Edit Comment`
- `Redmine: Add Comment`

### Command Usage Details

#### Redmine: Refresh Projects

1. Open the "Redmine Projects" view in the Explorer sidebar.
2. Run the command to reload the project list.

#### Redmine: Refresh Tickets

1. Ensure a project is selected.
2. Open the "Redmine Tickets" view.
3. Run the command to reload tickets for the selected project.

#### Redmine: Select Project

1. Run the command.
2. Enter a numeric project ID.
3. Tickets and comments refresh for the selected project.

#### Redmine: Toggle Child Projects

1. Run the command.
2. Ticket list reloads with or without child projects, based on the new toggle.

#### Redmine: Open Ticket Preview

1. Select a ticket in the "Redmine Tickets" view.
2. Run the command to open a read-only preview in the editor.

#### Redmine: Create Ticket from Editor

1. Open an editor with the content you want as the description.
2. Run the command and enter a subject.
3. Choose attachment sources (files or clipboard data URI).
4. The ticket is created with Mermaid blocks converted to `{{mermaid ... }}`.

#### Redmine: Edit Comment

1. Select a ticket and choose one of your own comments in "Redmine Comments".
2. The comment opens in a dedicated editor for editing.
3. Update the content and run the command to save the changes.

#### Redmine: Add Comment

1. Select a ticket in "Redmine Tickets".
2. Open an editor with the comment body (up to 20000 characters).
3. Run the command to post the active editor content.
4. Empty or whitespace-only content is blocked with a message.

## Debug

1. Open this repo in VS Code.
2. Run the "Run Extension" debug configuration (F5).
3. Configure settings in the Extension Host.
4. Use the commands above to verify behavior.

## Tests

- `pnpm test`: compile + lint + VS Code integration tests
- `pnpm run test:unsafe`: uses no-sandbox flags for environments that block
  the VS Code test runner

## Known Issues

- Clipboard attachments require a data URI in the clipboard.

## Release Notes

### 0.0.1

Initial release.
