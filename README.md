# Redmine Client

Redmine Client brings Redmine 6.1 ticket workflows into VS Code. Browse projects, triage tickets, preview details, create new issues from your editor content, and manage your own comments without leaving the editor.

Japanese README: `README.ja.md`

## Highlights

- Dedicated Activity Bar views for Projects, Tickets, and Comments
- Fast ticket browsing with status/assignee filters
- Read-only ticket preview in the editor
- Create new tickets from the active editor content
- Add attachments from files or clipboard data URI
- **Automatic image upload**: paste images in Markdown editors and they are automatically uploaded on save
- Mermaid blocks converted to redmica_ui_extension format (`{{mermaid ... }}`)
- Edit only your own comments safely

## Requirements

- Redmine 6.1 server
- Redmine API key with access to target projects

## Quick Start

1. Configure `redmine-client.baseUrl` and `redmine-client.apiKey`.
2. Set `redmine-client.defaultProjectId` or pick a project via command.
3. Open the **Projects** view and select a project.
4. Browse tickets in **Tickets** and open previews.
5. Use commands to create or update tickets/comments.
6. (Optional) Place ticket templates in `<editorStorageDirectory>/templates` to apply them on new tickets.

## Activity Bar Views

- **Projects**: Select the active project
- **Tickets**: Browse and filter project tickets
- **Comments**: View and edit your own comments

![alt text](./images/view.png)

## Extension Settings

- `redmine-client.baseUrl`: Base URL of the Redmine instance (include http:// or https://)
- `redmine-client.apiKey`: Redmine API key
- `redmine-client.defaultProjectId`: Default project identifier or ID
- `redmine-client.includeChildProjects`: Include child projects in ticket list
- `redmine-client.ticketListLimit`: Default number of tickets to load per request
- `redmine-client.editorStorageDirectory`: Storage directory for editor files and templates

## Ticket List Settings

Customize ticket list display from the Ticket Settings view.

### Filters

- **Status**: Show only tickets with specific statuses
- **Priority**: Show only tickets with specific priorities
- **Tracker**: Show only tickets with specific trackers
- **Assignee**: Show only tickets assigned to specific users

### Sorting

- **Sort**: Sort tickets by priority, status, due date, etc.
- **Due Date Display**: Show due dates in ticket list

### Editor Defaults

Set default values for new tickets:

- **Subject**: Default subject line
- **Description**: Default description text
- **Tracker**: Default tracker
- **Priority**: Default priority
- **Status**: Default status
- **Due date**: Default due date

## Ticket Templates

Templates are stored under `<editorStorageDirectory>/templates`.

- Project templates: file name must include the project name (case-insensitive exact match).
- Default template: `default.md` (used when no project template matches or matches are duplicated).

### Template Example

```markdown
---
issue:
  tracker:   Bug
  priority:  Low
  status:    New
  due_date:  
---

# Subproject issue two

This is a second issue on a cookbook subproject
```

## Commands

- `Redmine: Refresh Projects`
- `Redmine: Refresh Tickets`
- `Redmine: Select Project`
- `Redmine: Toggle Child Projects`
- `Redmine: Open Ticket Preview`
- `Redmine: Create Ticket from Editor`
- `Redmine: Edit Comment`
- `Redmine: Add Comment`
- `Redmine: Configure Ticket Priority Filter`
- `Redmine: Configure Ticket Status Filter`
- `Redmine: Configure Ticket Tracker Filter`
- `Redmine: Configure Ticket Assignee Filter`
- `Redmine: Configure Ticket Sort`
- `Redmine: Reset Ticket Settings`

## Tips

- Attachments: choose files or use a clipboard data URI
- Mermaid: blocks are converted to `{{mermaid ... }}` during submission
- Image paste: paste images directly into the editor, they are saved locally and uploaded when you save the comment/ticket

## Debug

1. Open this repo in VS Code.
2. Run the "Run Extension" debug configuration (F5).
3. Configure settings in the Extension Host.
4. Verify behavior with the commands above.

## Tests

- `pnpm test`: compile + lint + VS Code integration tests
- `pnpm run test:unsafe`: uses no-sandbox flags for environments that block the VS Code test runner

## Known Issues

- Clipboard attachments require a data URI in the clipboard.
- Image paste is only available in file-based editors. New ticket/comment drafts (untitled editors) require saving first before pasting images.

## License

MIT
