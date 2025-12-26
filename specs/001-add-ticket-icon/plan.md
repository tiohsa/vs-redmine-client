# Implementation Plan: Add Ticket Add Icon

**Branch**: `001-add-ticket-icon` | **Date**: 2025-12-27 | **Spec**: `/home/glorydays/projects/src/ts/todoex/specs/001-add-ticket-icon/spec.md`
**Input**: Feature specification from `/specs/001-add-ticket-icon/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Add a new ticket add icon to the ticket list header that launches the existing new-ticket flow, provides accessible labeling, respects permissions (visible but disabled for users without create permission), preserves existing header actions, and focuses an existing draft instead of creating duplicates.

## Technical Context

**Language/Version**: TypeScript 5.9  
**Primary Dependencies**: VS Code Extension API, webpack, @vscode/test-cli  
**Storage**: N/A (no new persistence)  
**Testing**: @vscode/test-cli (unit tests)  
**Target Platform**: VS Code desktop extension  
**Project Type**: single (extension)  
**Performance Goals**: N/A (UI-only interaction)  
**Constraints**: No change to persistence; do not disrupt existing header actions; respect permissions  
**Scale/Scope**: Single ticket list header action

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- TDD: unit tests written first and confirmed Red before implementation.
- TypeScript strict mode remains enabled; type checks pass.
- DRY: no duplicated business logic without justification.

## Project Structure

### Documentation (this feature)

```text
specs/001-add-ticket-icon/
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

tests/
```

**Structure Decision**: Single project layout with source in `src/` and tests in `tests/`.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
