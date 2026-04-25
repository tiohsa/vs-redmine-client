# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VS Code extension that brings Redmine 6.1 ticket workflows into the editor. Users can browse projects, triage tickets, create issues from editor content, manage comments, upload images, and work offline with a manual sync queue.

- **Language**: TypeScript 5.9, strict mode required
- **Target**: VS Code 1.107+
- **Package manager**: pnpm
- **Build**: Webpack 5 (entry: `src/extension.ts`, output: `dist/extension.js`)
- **Tests**: `@vscode/test-cli` + Mocha

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

**`src/utils/`** — Utilities (notifications, URL construction, Mermaid→redmica conversion, template resolution)

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
