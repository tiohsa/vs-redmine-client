# Implementation Plan: 一覧行のブラウザ表示アイコン追加

**Branch**: `001-open-in-browser` | **Date**: 2025-12-29 | **Spec**: /home/glorydays/projects/src/ts/todoex/specs/001-open-in-browser/spec.md
**Input**: Feature specification from `/specs/001-open-in-browser/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Add per-row “open in browser” icons to the Activity Bar project, ticket, and comment lists, generate Redmine URLs (including comment anchors), and open them in the system browser with user-facing errors for invalid URL generation or launch failures.

## Technical Context

**Language/Version**: TypeScript 5.9
**Primary Dependencies**: VS Code Extension API, webpack 5, @vscode/test-cli, ESLint
**Storage**: N/A
**Testing**: @vscode/test-cli (Mocha + Node assert)
**Target Platform**: VS Code 1.107+ extension runtime
**Project Type**: Single extension project
**Performance Goals**: N/A (UI actions)
**Constraints**: Icons only in Activity Bar lists; comment URLs use `issues/<ticketId>#note-<commentId>`; show errors on URL or browser failures.
**Scale/Scope**: Three Activity Bar lists (projects, tickets, comments)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- TDD: unit tests written first and confirmed Red before implementation.
- TypeScript strict mode remains enabled; type checks pass.
- DRY: no duplicated business logic without justification.

## Project Structure

### Documentation (this feature)

```text
specs/001-open-in-browser/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── commands/
├── config/
├── redmine/
├── test/
├── utils/
├── views/
└── extension.ts

package.json
```

**Structure Decision**: Single extension project with view logic under `src/views` and commands under `src/commands`.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | N/A | N/A |
