# Change Specification: Add Explicit Command to Create a Redmine Ticket from a Regular Markdown File

## 1. Purpose

Add a new explicit VS Code command that allows users to create a new Redmine ticket from a regular Markdown file by parsing a Redmine-specific Markdown header and the file body.

The current implementation primarily handles Markdown files created or tracked by the extension, or files that match specific Redmine client filename patterns. A regular Markdown file such as `memo.md`, `task.md`, or `meeting-note.md` is not treated as a new Redmine ticket draft by the existing save-sync classification flow.

This change introduces a deliberate command-based workflow instead of automatic ticket creation on file save.

---

## 2. Background

The extension already has core capabilities that can be reused:

- Markdown ticket content parsing through `parseTicketEditorContent()`
- Redmine issue creation through `createTicketFromContent()`
- Metadata parsing for Redmine issue fields
- Existing project selection and default project ID fallback
- Existing notification and command registration patterns
- Existing ticket document registration behavior

Therefore, this feature should not duplicate Redmine API creation logic. It should bridge a regular Markdown file to the existing ticket creation pipeline.

---

## 3. Feature Overview

### Feature Name

`Create Ticket from Markdown Header`

### Command ID

```text
redmine-client.createTicketFromMarkdownHeader
```

### Command Palette Title

```text
Redmine: Create Ticket from Markdown Header
```

### Japanese Title

```text
Redmine: Markdownヘッダからチケットを作成
```

### User Workflow

1. User creates or opens a regular Markdown file.
2. User writes a Redmine-specific frontmatter header.
3. User writes the ticket subject as an H1 heading.
4. User writes the ticket description as Markdown body content.
5. User runs the command from the VS Code Command Palette.
6. The extension validates the file.
7. The extension shows a confirmation dialog.
8. If confirmed, the extension creates a Redmine ticket.
9. On success, the extension updates the Markdown header with the created `issue_id`.

---

## 4. Scope

### 4.1 In Scope

| Area | Description |
|---|---|
| Regular Markdown files | Any `.md` file or editor with `languageId === "markdown"` |
| Explicit command execution | Command Palette execution |
| New Redmine ticket creation | Create one Redmine issue from one Markdown file |
| Redmine-specific frontmatter | Header containing `mode: new-ticket` and `issue:` |
| Duplicate creation prevention | Stop execution when `issue_id` already exists |
| Post-creation header update | Add `issue_id`, update `mode`, and add `last_synced_at` |
| Existing parser reuse | Use `parseTicketEditorContent()` |
| Existing creation reuse | Use `createTicketFromContent()` |
| Existing image upload behavior | Reuse the current Markdown image upload flow through existing creation logic |

### 4.2 Out of Scope

| Area | Reason |
|---|---|
| Automatic creation on save | Too risky because Redmine creation is an external side effect |
| Existing ticket update | This feature is only for new ticket creation |
| Explorer context menu | Future enhancement |
| Bulk creation from multiple files | Out of MVP scope |
| Mixed Obsidian/frontmatter metadata support | Risk of destructive header rewriting |
| Preservation of arbitrary YAML keys/comments | Requires YAML AST-level editing |
| Multiple tickets from one file | Out of MVP scope |
| Comment creation | Not part of this feature |

---

## 5. MVP Design Decision

The MVP must be intentionally strict.

### Required MVP Constraints

- `mode: new-ticket` is mandatory.
- `issue_id` must be absent.
- Only Redmine-specific frontmatter is supported.
- One Markdown file creates one Redmine ticket.
- The command must show a confirmation dialog before creating the Redmine ticket.
- The file must be updated only after Redmine ticket creation succeeds.
- If Redmine creation fails, the Markdown file must remain unchanged.
- If Markdown header update fails after Redmine creation, the user must be warned with the created issue ID.

### Rationale

Creating a Redmine ticket is an external side effect. A normal Markdown file should not be accidentally converted into a Redmine issue. The explicit command plus strict `mode: new-ticket` requirement reduces accidental creation and duplicate registration risks.

---

## 6. Supported Markdown Format

### 6.1 Required Format

```markdown
---
mode: new-ticket
project_id: 123
issue:
  tracker:   Task
  priority:  Normal
  status:    New
  assignee:
  assignee_id:
  start_date:
  due_date:
---

# Ticket subject

Ticket description goes here.

## Background

- Background item 1
- Background item 2

## Work Items

- Work item 1
- Work item 2
```

### 6.2 Required Conditions

| Condition | Description |
|---|---|
| Markdown file | File extension `.md` or VS Code language ID `markdown` |
| Frontmatter exists | File starts with `---` |
| `mode: new-ticket` exists | Required to prevent accidental creation |
| `issue:` block exists | Required for Redmine issue fields |
| H1 heading exists | First `# Heading` becomes the Redmine issue subject |
| `issue_id` does not exist | Prevents duplicate ticket creation |

---

## 7. Frontmatter Specification

### 7.1 Allowed Control Fields Before `issue:`

The following fields are allowed before the `issue:` block:

```yaml
mode:
project_id:
issue_id:
parent_issue_id:
draft_id:
last_synced_at:
lock_version:
```

### 7.2 Required Control Field

| Field | Required | Description |
|---|---:|---|
| `mode` | Yes | Must be `new-ticket` |

### 7.3 Optional Control Fields

| Field | Description |
|---|---|
| `project_id` | Redmine project ID. Highest priority for project resolution |
| `issue_id` | Created Redmine issue ID. If present, command must stop |
| `last_synced_at` | Timestamp written after successful ticket creation |
| `lock_version` | Reserved for future update-sync behavior |

---

## 8. Issue Metadata Specification

### 8.1 Required Issue Fields

The following fields are required in the `issue:` block:

| Field | Required | Notes |
|---|---:|---|
| `tracker` | Yes | Redmine tracker name |
| `priority` | Yes | Redmine priority name |
| `status` | Yes | Redmine status name |
| `due_date` | Yes | Empty value is allowed, but the key must exist |

### 8.2 Optional Issue Fields

| Field | Description |
|---|---|
| `assignee` | Assignee name |
| `assignee_id` | Assignee ID |
| `start_date` | Start date in `YYYY-MM-DD` format |
| `done_ratio` | Done ratio, 0 to 100 |
| `estimated_hours` | Estimated hours |
| `parent` | Parent Redmine issue ID |
| `children` | Child ticket subject list |

### 8.3 Unsupported Frontmatter Example

The MVP must reject mixed general-purpose frontmatter such as:

```yaml
---
title: Meeting note
tags:
  - redmine
mode: new-ticket
project_id: 123
issue:
  tracker: Task
  priority: Normal
  status: New
  due_date:
---
```

### Reason

The MVP will update the Redmine-specific frontmatter after creation. If arbitrary YAML keys or comments are allowed, they may be lost during normalization. To avoid destructive behavior, mixed frontmatter is not supported in the MVP.

---

## 9. Functional Behavior

### 9.1 Normal Flow

| Step | Process | Description |
|---:|---|---|
| 1 | Get active editor | Use `vscode.window.activeTextEditor` |
| 2 | Validate Markdown file | Accept `.md` or `languageId === "markdown"` |
| 3 | Read file content | Use `editor.document.getText()` |
| 4 | Validate Redmine frontmatter | Require `mode: new-ticket` and `issue:` |
| 5 | Parse ticket content | Use `parseTicketEditorContent()` |
| 6 | Prevent duplicate creation | Stop if `issue_id` exists |
| 7 | Resolve project ID | `project_id` → selected project → default project ID |
| 8 | Show confirmation dialog | Display summary and ask user to confirm |
| 9 | Create Redmine ticket | Use `createTicketFromContent()` |
| 10 | Update Markdown header | Write `issue_id`, `mode: ticket-update`, `last_synced_at` |
| 11 | Register document | Register the document as an existing ticket editor if applicable |
| 12 | Notify success | Show created Redmine ticket ID |

---

## 10. Confirmation Dialog

Before creating a Redmine ticket, show a confirmation dialog.

### Example Message

```text
Create Redmine ticket?

Project ID: 123
Subject: Ticket subject
Tracker: Task
Priority: Normal
Status: New
```

### Buttons

| Button | Behavior |
|---|---|
| `Create` | Continue and create the Redmine ticket |
| `Cancel` | Stop without changes |

### Requirement

No Redmine API call must be made before the user confirms.

---

## 11. Project ID Resolution

Project ID must be resolved in this order:

| Priority | Source | Notes |
|---:|---|---|
| 1 | `project_id` in Markdown header | Explicit file-level value |
| 2 | Selected project in Dashboard | Existing project selection |
| 3 | `redmine-client.defaultProjectId` | Existing VS Code configuration |
| 4 | Unresolved | Show error and stop |

### Error Message

```text
Select a project or set project_id/defaultProjectId before creating a ticket.
```

---

## 12. Post-Creation Markdown Update

### 12.1 Before Creation

```markdown
---
mode: new-ticket
project_id: 123
issue:
  tracker:   Task
  priority:  Normal
  status:    New
  due_date:
---

# Ticket subject

Body text.
```

### 12.2 After Successful Creation

```markdown
---
mode: ticket-update
project_id: 123
issue_id: 456
last_synced_at: 2026-05-31T10:30:00.000Z
issue:
  tracker:   Task
  priority:  Normal
  status:    New
  due_date:
---

# Ticket subject

Body text.
```

### 12.3 Update Rules

| Field | Update Rule |
|---|---|
| `mode` | Change from `new-ticket` to `ticket-update` |
| `project_id` | Write the resolved project ID |
| `issue_id` | Write the created Redmine issue ID |
| `last_synced_at` | Write the current ISO timestamp |
| `issue:` block | Preserve or normalize using existing serialization |
| Body | Preserve the ticket description body |

### 12.4 Failure During Header Update

If Redmine creation succeeds but Markdown update fails, do not roll back the Redmine ticket.

Show this warning:

```text
Redmine ticket created (#456), but failed to update the Markdown header.
Add issue_id: 456 manually to prevent duplicate creation.
```

### Rationale

Deleting a successfully created Redmine ticket as rollback may be more harmful than leaving it created. The user should be given the created issue ID so they can manually update the Markdown header and avoid duplicate creation.

---

## 13. Duplicate Creation Prevention

### 13.1 Stop Conditions

The command must not create a Redmine ticket when any of the following are true:

| Condition | Message |
|---|---|
| `issue_id` exists | `Already linked to Redmine ticket #456.` |
| `mode: ticket-update` | `This Markdown file is already marked as a ticket update file.` |
| `mode` is missing | `Set mode: new-ticket to create a Redmine ticket from this Markdown file.` |
| `mode` is not `new-ticket` | `Unsupported mode for ticket creation: {mode}` |

### 13.2 API Call Guard

If `issue_id` exists, `createIssue` or `createTicketFromContent()` must not be called.

---

## 14. Error Handling

| No. | Condition | Expected Message |
|---:|---|---|
| 1 | No active editor | `No active editor found.` |
| 2 | Not Markdown | `Open a Markdown file before creating a Redmine ticket.` |
| 3 | Missing frontmatter | `Redmine metadata block is missing.` |
| 4 | Missing `mode` | `Set mode: new-ticket to create a Redmine ticket from this Markdown file.` |
| 5 | Existing `issue_id` | `Already linked to Redmine ticket #{0}.` |
| 6 | Missing subject | `Subject line is missing.` |
| 7 | Missing required issue metadata | Use existing parser error |
| 8 | Project ID unresolved | `Select a project or set a default project ID before creating tickets.` |
| 9 | User cancelled confirmation | No error notification, or `Ticket creation cancelled.` |
| 10 | Redmine API failure | Use existing error mapping/notification |
| 11 | Markdown update failure after creation | `Redmine ticket created (#{0}), but failed to update the Markdown header.` |

---

## 15. Module Design

### 15.1 New File: `src/commands/createTicketFromMarkdownHeader.ts`

#### Responsibilities

- Get active editor
- Validate Markdown editor/file
- Call service
- Show confirmation dialog
- Apply resulting text edit to the active document
- Show success, warning, or error notifications

#### Notes

This file should remain thin. It should not contain Redmine metadata parsing or creation logic beyond command orchestration.

---

### 15.2 New File: `src/views/markdownTicketCreateService.ts`

#### Responsibilities

- Validate content as Redmine ticket Markdown
- Parse with `parseTicketEditorContent()`
- Validate `mode: new-ticket`
- Validate absence of `issue_id`
- Resolve project ID
- Build confirmation summary
- Call `createTicketFromContent()`
- Generate updated Markdown content after successful creation

#### Suggested Public API

```ts
export type MarkdownTicketCreatePreview = {
  projectId: number;
  subject: string;
  tracker: string;
  priority: string;
  status: string;
};

export type MarkdownTicketCreateResult =
  | {
      status: "created";
      issueId: number;
      updatedContent: string;
      preview: MarkdownTicketCreatePreview;
    }
  | {
      status: "failed";
      message: string;
    };

export const previewMarkdownTicketCreation = async (
  content: string,
): Promise<MarkdownTicketCreatePreview>;

export const createTicketFromMarkdownContent = async (input: {
  content: string;
  projectId?: number;
  baseDir?: string;
}): Promise<MarkdownTicketCreateResult>;
```

The exact type shape can be adjusted during implementation, but parsing, validation, project resolution, and Redmine creation should be testable without VS Code UI dependencies.

---

### 15.3 New File: `src/views/markdownTicketHeaderUpdater.ts`

#### Responsibilities

- Update Redmine-specific frontmatter
- Change `mode` from `new-ticket` to `ticket-update`
- Add or update `project_id`
- Add `issue_id`
- Add `last_synced_at`
- Detect unsupported mixed frontmatter

#### MVP Rule

The updater may normalize the Redmine-specific header, but it must reject general-purpose frontmatter that contains unsupported keys before `issue:`.

---

## 16. Existing File Changes

### 16.1 `package.json`

Add the new activation event:

```json
"onCommand:redmine-client.createTicketFromMarkdownHeader"
```

Add the new contributed command:

```json
{
  "command": "redmine-client.createTicketFromMarkdownHeader",
  "title": "%command.createTicketFromMarkdownHeader.title%",
  "icon": "$(add)"
}
```

---

### 16.2 `src/app/commandRegistry.ts`

Import the new command:

```ts
import { createTicketFromMarkdownHeader } from "../commands/createTicketFromMarkdownHeader";
```

Register the command:

```ts
vscode.commands.registerCommand(
  "redmine-client.createTicketFromMarkdownHeader",
  async () => {
    await createTicketFromMarkdownHeader();
  },
)
```

---

### 16.3 `l10n/bundle.l10n.json`

Add English localization entries.

```json
{
  "command.createTicketFromMarkdownHeader.title": "Redmine: Create Ticket from Markdown Header",
  "Open a Markdown file before creating a Redmine ticket.": "Open a Markdown file before creating a Redmine ticket.",
  "Redmine metadata block is missing.": "Redmine metadata block is missing.",
  "Set mode: new-ticket to create a Redmine ticket from this Markdown file.": "Set mode: new-ticket to create a Redmine ticket from this Markdown file.",
  "Already linked to Redmine ticket #{0}.": "Already linked to Redmine ticket #{0}.",
  "This Markdown file is already marked as a ticket update file.": "This Markdown file is already marked as a ticket update file.",
  "Unsupported mode for ticket creation: {0}": "Unsupported mode for ticket creation: {0}",
  "Create Redmine ticket?": "Create Redmine ticket?",
  "Create": "Create",
  "Ticket creation cancelled.": "Ticket creation cancelled.",
  "Redmine ticket created (#{0}).": "Redmine ticket created (#{0}).",
  "Redmine ticket created (#{0}), but failed to update the Markdown header.": "Redmine ticket created (#{0}), but failed to update the Markdown header.",
  "Add issue_id: {0} manually to prevent duplicate creation.": "Add issue_id: {0} manually to prevent duplicate creation."
}
```

---

### 16.4 `l10n/bundle.l10n.ja.json`

Add Japanese localization entries.

```json
{
  "command.createTicketFromMarkdownHeader.title": "Redmine: Markdownヘッダからチケットを作成",
  "Open a Markdown file before creating a Redmine ticket.": "Redmineチケットを作成するMarkdownファイルを開いてください。",
  "Redmine metadata block is missing.": "Redmineメタデータブロックがありません。",
  "Set mode: new-ticket to create a Redmine ticket from this Markdown file.": "このMarkdownファイルからRedmineチケットを作成するには mode: new-ticket を設定してください。",
  "Already linked to Redmine ticket #{0}.": "このファイルはすでにRedmineチケット #{0} に紐づいています。",
  "This Markdown file is already marked as a ticket update file.": "このMarkdownファイルはすでにチケット更新ファイルとしてマークされています。",
  "Unsupported mode for ticket creation: {0}": "チケット作成ではサポートされていないmodeです: {0}",
  "Create Redmine ticket?": "Redmineチケットを作成しますか？",
  "Create": "作成",
  "Ticket creation cancelled.": "チケット作成をキャンセルしました。",
  "Redmine ticket created (#{0}).": "Redmineチケットを作成しました (#{0})。",
  "Redmine ticket created (#{0}), but failed to update the Markdown header.": "Redmineチケットを作成しました (#{0}) が、Markdownヘッダの更新に失敗しました。",
  "Add issue_id: {0} manually to prevent duplicate creation.": "二重作成を防ぐため、issue_id: {0} を手動で追加してください。"
}
```

---

## 17. Redmine Creation Logic

Do not implement a new Redmine issue creation API call.

Use the existing ticket creation function:

```ts
createTicketFromContent()
```

### Rationale

This reuses existing behavior for:

- Metadata resolution
- Tracker, priority, status resolution
- Due date and start date handling
- Assignee handling
- Parent ticket handling
- Child ticket creation
- Markdown image upload
- Error mapping

---

## 18. Test Specification

### 18.1 Normal Cases

| No. | Test | Expected Result |
|---:|---|---|
| 1 | Markdown with `mode: new-ticket` | Redmine creation is executed |
| 2 | `project_id` exists | That project ID is used |
| 3 | `project_id` missing but default project exists | Default project ID is used |
| 4 | H1 subject exists | Subject is passed to Redmine |
| 5 | Body exists | Body is passed as description |
| 6 | Creation succeeds | `issue_id` is added |
| 7 | Creation succeeds | `mode` becomes `ticket-update` |
| 8 | Creation succeeds | `last_synced_at` is added |
| 9 | Creation succeeds | Document can be registered as ticket document |
| 10 | Confirmation cancelled | No Redmine API call is made |

### 18.2 Error Cases

| No. | Test | Expected Result |
|---:|---|---|
| 1 | No active editor | Error notification |
| 2 | Non-Markdown file | Error notification |
| 3 | Missing frontmatter | Error notification |
| 4 | Missing `mode` | No Redmine creation |
| 5 | `mode: ticket-update` | No Redmine creation |
| 6 | `issue_id` exists | No Redmine creation |
| 7 | Missing `tracker` | Parser error |
| 8 | Missing `priority` | Parser error |
| 9 | Missing `status` | Parser error |
| 10 | Missing `due_date` key | Parser error |
| 11 | Redmine API failure | Markdown file is unchanged |
| 12 | Markdown update failure after creation | Warning includes created issue ID |

### 18.3 Frontmatter Compatibility Cases

| No. | Input | Expected Result |
|---:|---|---|
| 1 | Frontmatter contains `title:` before `issue:` | Reject in MVP |
| 2 | Frontmatter contains `tags:` before `issue:` | Reject in MVP |
| 3 | Unknown key before `issue:` | Reject in MVP |
| 4 | Unknown key inside `issue:` | Existing parser error |
| 5 | YAML comments in Redmine header | Not guaranteed in MVP; either reject or normalize |

### 18.4 Duplicate Prevention Cases

Input:

```markdown
---
mode: ticket-update
project_id: 123
issue_id: 456
issue:
  tracker:   Task
  priority:  Normal
  status:    New
  due_date:
---

# Existing ticket
```

Expected:

- Redmine creation is not executed.
- User sees `Already linked to Redmine ticket #456.`
- File is not modified.

---

## 19. Acceptance Criteria

The change is complete when all of the following are true:

- A regular `.md` file can create a Redmine ticket through the explicit command.
- Files without `mode: new-ticket` are not registered.
- Files with `issue_id` are not registered again.
- A confirmation dialog is shown before Redmine ticket creation.
- On successful creation, `issue_id` is written to the Markdown header.
- On successful creation, `mode` is changed to `ticket-update`.
- On successful creation, `last_synced_at` is written.
- If Redmine API creation fails, the Markdown file is not changed.
- If Markdown header update fails after successful creation, the user is shown the created issue ID.
- Existing save-sync behavior is not changed.
- Existing `redmine-client-new-ticket.md` draft workflow is not broken.
- Existing ticket update and comment flows continue to pass tests.

---

## 20. Implementation Order

1. Add `markdownTicketHeaderUpdater.ts`.
2. Add unit tests for header validation and update behavior.
3. Add `markdownTicketCreateService.ts`.
4. Add service tests for validation, project resolution, duplicate prevention, and creation result handling.
5. Add `createTicketFromMarkdownHeader.ts`.
6. Add command registration in `commandRegistry.ts`.
7. Add command contribution and activation event to `package.json`.
8. Add l10n entries.
9. Add integration-style command tests.
10. Run existing test suite and confirm no regression.

---

## 21. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Duplicate Redmine ticket creation | High | Require `mode: new-ticket`, block `issue_id`, show confirmation |
| Header update failure after creation | Medium | Warn with created issue ID and manual recovery instruction |
| Destructive rewrite of general frontmatter | Medium | Reject unsupported frontmatter in MVP |
| Regression in existing save-sync flow | High | Do not modify save-sync classifier for this MVP |
| Service too dependent on VS Code APIs | Medium | Keep parsing/creation logic in service layer, keep command layer thin |
| User confusion about supported format | Medium | Document required Markdown template clearly |

---

## 22. Recommended Final Direction

This feature is worth implementing, but it should remain explicit and conservative.

The recommended MVP is:

```yaml
mode: new-ticket
```

plus a Redmine-specific `issue:` block, processed only when the user runs:

```text
Redmine: Create Ticket from Markdown Header
```

Do not implement save-triggered creation in this change. Do not support arbitrary frontmatter preservation in the MVP. These restrictions keep the feature safe, testable, and compatible with the existing extension architecture.

