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

- `todoex.baseUrl`: Base URL of the Redmine instance
- `todoex.apiKey`: Redmine API key
- `todoex.defaultProjectId`: Default project identifier or ID
- `todoex.includeChildProjects`: Include child projects in ticket list
- `todoex.ticketListLimit`: Default number of tickets to load per request

## Usage

1. Configure `todoex.baseUrl` and `todoex.apiKey`.
2. Set `todoex.defaultProjectId` or use the command to select a project.
3. Browse tickets in the "Redmine Tickets" view.
4. Select a project in the "Redmine Projects" view to load tickets.
5. Select a ticket to preview details and load comments.
6. Use the "Redmine: Create Ticket from Editor" command to create a ticket.
7. Use the "Redmine: Edit Comment" command to update your own comments.

## Commands

- `Redmine: Refresh Projects`
- `Redmine: Refresh Tickets`
- `Redmine: Select Project`
- `Redmine: Toggle Child Projects`
- `Redmine: Open Ticket Preview`
- `Redmine: Create Ticket from Editor`
- `Redmine: Edit Comment`

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
