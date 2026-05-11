# Redmine Client

Redmine Client brings Redmine 6.1 ticket workflows into VS Code through a single Dashboard Webview in the Activity Bar.

Japanese README: `README.ja.md`

## Highlights

- Single **Dashboard Webview** with Tickets / Unsynced / Comments / Settings tabs
- Fast ticket browsing with status, priority, tracker, assignee, and title filters
- Create new tickets and child tickets directly from the Dashboard composer
- Open tickets as editable Markdown files — save locally or sync to Redmine immediately
- After a new ticket is created, the same Markdown file stays open and becomes an update file for that ticket
- **Offline / Unsynced queue**: queue ticket saves, comment drafts, and new ticket drafts, then sync individually or all at once
- **Conflict detection with diff view**: detect remote changes before saving and resolve via diff editor
- **Automatic image upload**: paste images in Markdown editors and they are uploaded on save
- Mermaid blocks converted to redmica_ui_extension format (`{{mermaid ... }}`)
- **Draft persistence**: ticket and comment drafts survive VS Code restarts
- API key stored securely in VS Code SecretStorage

## Requirements

- Redmine 6.1 server
- Redmine API key with access to target projects

## Security

- Use `Redmine: Set API Key` to store the API key in **VS Code SecretStorage**.
- `ignoreSSLErrors` is for development/testing only. **Do not enable in production.**

## Quick Start

1. Set `redmine-client.baseUrl` in VS Code settings.
2. Run `Redmine: Set API Key` from the Command Palette to store your API key securely.
3. Open the Redmine Client Activity Bar icon to open the Dashboard.
4. Select a project from the project dropdown.
5. Click a ticket to select it; double-click to open it as a Markdown editor.
6. Edit and save — changes are synced immediately (auto mode) or queued (manual mode).

## Dashboard

The extension provides a single Activity Bar Dashboard Webview with four tabs:

| Tab | Description |
|-----|-------------|
| **Tickets** | Browse and filter project tickets; select a ticket to view its detail panel |
| **Unsynced** | Manage pending ticket updates, new ticket drafts, and comment drafts |
| **Comments** | View and edit comments for the selected ticket |
| **Settings** | Configure filters, sort order, offline sync mode, and editor defaults |

### Ticket Tab

The Tickets tab shows the ticket list for the selected project.

**Ticket row actions:**
- **Single click** — select ticket and show detail panel
- **Double click** — open ticket as a Markdown editor
- **⋮ menu** — Open editor, Add comment, Open in browser, Create child ticket

**Detail panel** shows ticket metadata (ID, subject, project, tracker, status, priority, dates, parent) and provides inline metadata editing and a sync action.

### Unsynced Tab

The Unsynced tab lists all pending items:

- Existing ticket updates
- New ticket drafts
- Comment drafts
- Comment updates

Supported actions per item:

| Action | Description |
|--------|-------------|
| Open file | Open the local Markdown draft |
| Sync one | Upload this item to Redmine |
| Discard | Remove from the unsynced queue |

A **Sync all** button uploads all queued items at once.

## Workflows

### Basic Ticket Editing

1. Select a project in the Dashboard.
2. Select a ticket from the ticket list.
3. Double-click or choose **Open editor** from the ⋮ menu.
4. Edit the Markdown file (subject in the YAML front matter, body below).
5. Save with Ctrl+S.
6. In **auto** sync mode, changes are sent to Redmine immediately.
7. In **manual** sync mode, the edit is added to the Unsynced queue. Use the Unsynced tab to sync later.

### New Ticket

1. Click **New Ticket** in the Dashboard (or run `Redmine: New Ticket`).
2. Fill in Tracker, Priority, Status, Start Date, Due Date in the composer.
   - Only trackers enabled for the selected project are shown.
3. Click **Create Draft** to open a Markdown editor for the new ticket.
4. Edit the subject and description in the Markdown file.
5. Save — the draft is queued in the Unsynced tab.
6. Sync from the Unsynced tab or via `Redmine: Sync to Redmine`.
7. After successful creation on Redmine, **the same Markdown file remains open** and automatically becomes a ticket-update file for the created issue. Subsequent saves update that issue instead of creating a new one.

### Child Ticket

1. Select a parent ticket in the ticket list.
2. Choose **Create child ticket** from the ⋮ menu.
3. Fill in the composer (Tracker, Priority, Status, dates). Parent ticket information is pre-filled.
4. Click **Create Draft** to open a Markdown editor.
5. Edit and sync.
6. After creation, the Markdown file becomes an update file for the child issue.

## Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `redmine-client.baseUrl` | `""` | Base URL of the Redmine instance (include `http://` or `https://`) |
| `redmine-client.ignoreSSLErrors` | `false` | Ignore SSL certificate errors (development/testing only) |
| `redmine-client.defaultProjectId` | `""` | Default project identifier or numeric ID |
| `redmine-client.includeChildProjects` | `false` | Include child projects when listing tickets |
| `redmine-client.ticketListLimit` | `50` | Number of tickets loaded per request (1–500) |
| `redmine-client.editorStorageDirectory` | `""` | Absolute path for storing editor files (empty = workspace default) |
| `redmine-client.offlineSyncMode` | `"auto"` | `auto` syncs immediately on save; `manual` queues for the Unsynced tab |
| `redmine-client.requestTimeoutMs` | `30000` | HTTP request timeout in milliseconds |
| `redmine-client.ticketList.showStatus` | `true` | Show the status badge on each ticket row in the Dashboard |
| `redmine-client.ticketList.showDueDate` | `true` | Show due date badges on ticket rows |

## Commands

### API Key

| Command | Description |
|---------|-------------|
| `Redmine: Set API Key` | Store the API key in VS Code SecretStorage |
| `Redmine: Clear API Key` | Remove the stored API key |
| `Redmine: Show API Key Status` | Show where the API key is currently stored |

### Sync Commands

| Command | Description |
|---------|-------------|
| `Redmine: Sync to Redmine` | Sync the active ticket/comment editor to Redmine |
| `Redmine: Upload Open Editor` | Sync a specific open editor |
| `Redmine: Upload All Open Editors` | Sync all open ticket/comment editors |
| `Redmine: Sync This File` | Upload a specific item from the Unsynced queue |
| `Redmine: Run Offline Sync` | Upload all items in the Unsynced queue |
| `Redmine: Configure Offline Sync Mode` | Switch between `auto` and `manual` sync |

### Ticket Commands

| Command | Description |
|---------|-------------|
| `Redmine: New Ticket` | Open the new-ticket composer in the Dashboard |
| `Redmine: Create Ticket from Editor` | Create a ticket from the active editor content |
| `Redmine: Add Child Ticket` | Create a child ticket for the selected ticket |
| `Redmine: Open Ticket Preview` | Open a read-only ticket preview in an editor |
| `Redmine: Open Ticket Editor (New)` | Open an additional ticket editor |
| `Redmine: Reload Ticket` | Reload the active ticket editor from Redmine |
| `Redmine: Search Tickets` | Search tickets by keyword |
| `Redmine: Focus Active Ticket` | Reveal the active ticket editor's ticket in the Dashboard |
| `Redmine: Focus Open Ticket Editor` | Focus the open editor for the selected ticket |
| `Redmine: Open Ticket in Browser` | Open the selected ticket in a browser |

### Comment Commands

| Command | Description |
|---------|-------------|
| `Redmine: Add Comment` | Add a new comment to the selected ticket |
| `Redmine: Edit Comment` | Open the selected comment in an editor |
| `Redmine: Reload Comment` | Reload the active comment editor from Redmine |
| `Redmine: Open Comment in Browser` | Open the selected comment in a browser |

### Editor Default Commands

| Command | Description |
|---------|-------------|
| `Redmine: Configure Editor Default Subject` | Set the default subject for new tickets |
| `Redmine: Configure Editor Default Description` | Set the default description |
| `Redmine: Configure Editor Default Tracker` | Set the default tracker |
| `Redmine: Configure Editor Default Priority` | Set the default priority |
| `Redmine: Configure Editor Default Status` | Set the default status |
| `Redmine: Configure Editor Default Due Date` | Set the default due date |
| `Redmine: Reset Editor Defaults` | Clear all editor default values |

### Other Commands

| Command | Description |
|---------|-------------|
| `Redmine: Refresh Projects` | Reload the project list |
| `Redmine: Refresh Tickets` | Reload the ticket list |
| `Redmine: Refresh Comments` | Reload the comment list |
| `Redmine: Reload Project` | Reload the selected project |
| `Redmine: Select Project` | Switch the active project by ID |
| `Redmine: Toggle Child Projects` | Include or exclude child projects in the ticket list |
| `Redmine: Open Project in Browser` | Open the selected project in a browser |

## Tips

- **Sync button**: the `$(cloud-upload)` icon in the editor title bar runs `Redmine: Sync to Redmine` — useful when auto-save is on.
- **Draft persistence**: ticket/comment drafts are saved in VS Code global state and survive restarts.
- **Image paste**: paste images directly into a file-based editor; they are uploaded on save. For new ticket/comment drafts (untitled editors), save the file first before pasting images.
- **Conflict resolution**: when remote changes are detected, choose **Local Priority**, **Remote Priority**, or **View Diff**.
- **Mermaid**: blocks are converted to `{{mermaid ... }}` on submission to Redmine.
- **Status bar**: the current ticket ID is shown in the status bar when a ticket editor is active.
- **Project-specific trackers**: the new-ticket composer and metadata editor show only trackers enabled for the selected project.

## Development

```bash
pnpm test              # compile + lint + VS Code integration tests
pnpm run test:unsafe   # no-sandbox variant for restricted environments
```

To debug locally, open this repo in VS Code and run the **Run Extension** debug configuration (F5). Configure extension settings in the Extension Host window.

## License

MIT
