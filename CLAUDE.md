# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

### 1. Task Delegation Block

Have Claude spawn sub-agents and select the cheapest model appropriate for the task:

* **Haiku**: Large volumes of mechanical tasks, no judgment required
* **Sonnet**: Limited research, code exploration, synthesis
* **Opus**: Only when real planning or trade-offs are required

Set two constraints:

* Haiku must not spawn further sub-agents (if needed, the task sizing is incorrect)
* Maximum generation depth is 2 (parent → sub-agent → one additional layer)

If a sub-agent determines that a more capable model is required, it must return control to the parent instead of escalating on its own.

---

### 2. Preferred Tools Block

Have Claude prioritize free options first:

* **WebFetch**: For public pages (free, text-only)
* **agent-browser CLI**: For dynamic pages or authentication walls (uses ~82% fewer tokens than screenshot-based tools)
* **pdftotext**: For PDFs, instead of using the Read tool

If Claude repeatedly retrieves data using the same method, instruct it to wrap that pattern into a reusable tool.

---

### 3. settings.json (2 lines)

* `"CLAUDE_CODE_DISABLE_1M_CONTEXT": "1"` — Prevent loading an unnecessarily large context window
* `"CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "80"` — Trigger auto-compaction at 80% instead of waiting until full

---

## Project Overview

VS Code extension that brings Redmine 6.1 ticket workflows into the editor. Users can browse projects, triage tickets, create issues from editor content, manage comments, upload images, and work offline with a manual sync queue.

- **Language**: TypeScript 5.9, strict mode required
- **Target**: VS Code 1.107+
- **Package manager**: pnpm
- **Build**: Webpack 5 (entry: `src/extension.ts`, output: `dist/extension.js`)
- **Tests**: `@vscode/test-cli` + Mocha

# Design System Guidelines 

You must strictly refer to `design.md` located in the project root as the absolute Single Source of Truth (SSoT) for all frontend implementations.

## Compliance Requirements
- [cite_start]**Enforced Design**: When creating new components or modifying existing UI, you must use the colors, typography, spacing, and component patterns defined in `design.md`[cite: 31, 133].
- [cite_start]**Prohibit Custom Values**: Do not invent arbitrary hex codes or custom spacing values not found in `design.md`[cite: 128, 312]. [cite_start]If a specific definition is missing, infer the closest semantic role from the existing system or ask for clarification[cite: 308].
- [cite_start]**Framework Mapping**: Accurately map the tokens in `design.md` to the project's styling utilities (e.g., Tailwind CSS config, CSS variables)[cite: 78, 134].

## Implementation Process
1. [cite_start]Before implementing, read `design.md` to identify required tokens (e.g., `primary-color`, `border-radius`)[cite: 43, 60].
2. [cite_start]Implement interactive states (Hover, Active, Disabled) exactly as specified in the document[cite: 47, 74].
3. [cite_start]Perform a self-audit after generation to ensure the code matches the design system specifications[cite: 80, 130].


## Commands

```bash
pnpm run compile        # Webpack build (development)
pnpm run watch          # Webpack watch mode
pnpm run package        # Production build (used by vscode:prepublish)
pnpm run lint           # ESLint check
pnpm test               # Full pipeline: compile-tests + compile + lint + vscode-test
pnpm run test:unsafe    # Test runner without sandbox (restricted environments)
```

## Architecture

### Entry Point

`src/extension.ts` — registers all commands and view providers on activation.

### Layer Structure

**`src/redmine/`** — HTTP API layer  
- `client.ts`: HTTP client with API key auth, SSL handling, base URL normalization  
- `issues.ts`, `projects.ts`, `comments.ts`, `users.ts`, `attachments.ts`: domain operations  
- `types.ts`: shared TypeScript interfaces (Project, Ticket, Comment, Filter, etc.)

**`src/config/`** — VS Code workspace settings  
- `settings.ts`: reads all 7 extension settings (baseUrl, apiKey, filters, offlineSyncMode, etc.)  
- `projectSelection.ts`: active project selection state

**`src/commands/`** — Command handlers invoked from the Activity Bar or Command Palette  
- Ticket commands: create, createFromList, createChild, reload, search  
- Comment commands: add, edit, addFromList, reload, prompt  
- Sync commands: offlineSync, offlineSyncMode  
- UI commands: openInBrowser, focusTicketEditor

**`src/views/`** — Activity Bar tree providers and editor management (bulk of codebase)  
- `projectsView.ts`, `ticketsView.ts`, `commentsView.ts`, `openTicketsView.ts`, `ticketSettingsView.ts`: tree providers  
- `ticketEditorRegistry.ts`: maps open editors to ticket/comment IDs  
- `ticketEditorContent.ts`: parses YAML frontmatter + markdown body in editors  
- `ticketSaveSync.ts`, `commentSaveSync.ts`: save operations with conflict detection  
- `conflictResolver.ts`, `conflictDiffProvider.ts`: diff view for remote change conflicts  
- `offlineSyncStore.ts`: queues saves when offline sync mode is enabled  
- `markdownImageUpload.ts`, `markdownImageLinks.ts`, `markdownImageValidation.ts`: auto-upload pasted images  
- `treeBuilder.ts`, `treeState.ts`: tree hierarchy and expansion state persistence  
- `ticketMetadataYaml.ts`: YAML frontmatter parsing for ticket metadata

**`src/utils/`** — Utilities (notifications, URL construction, Mermaid→redmica conversion)

**`src/test/`** — 119+ test files covering all features; helpers/stubs in `src/test/helpers/`

**`specs/`** — Feature specifications and planning documents (Japanese)

## Coding Conventions

- TypeScript `strict` is mandatory; never lower type safety.
- Follow the existing ESLint config (`eslint.config.mjs`): camelCase/PascalCase naming, `curly` blocks, `eqeqeq`, no throw literals, semicolons.
- Do not perform large-scale refactors unrelated to the task.
- Do not revert existing changes you did not author.
- Add or update tests in `src/test/` for every change; run `pnpm test` or the relevant test subset and note results.

## Responses and Documentation

Write responses, review comments, and documentation in Japanese (as stated in AGENTS.md).

## Key Files to Update When Changing

If a PR changes `package.json` scripts, the main directory structure, or adds a major feature spec under `specs/`, update `AGENTS.md` in the same PR.
