# Implementation Plan: Ticket Editor Pinning

**Branch**: `001-ticket-editor-pinning` | **Date**: 2025-12-26 | **Spec**: /home/glorydays/projects/src/ts/todoex/specs/001-ticket-editor-pinning/spec.md
**Input**: Feature specification from `/specs/001-ticket-editor-pinning/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Provide a stable, per-ticket editor experience by reusing a dedicated editor when a ticket is reselected, keeping comment drafts bound to the ticket, and allowing explicit creation of additional editors for the same ticket. The plan focuses on tracking editor instances per ticket, honoring the last active editor when multiple are open, and ensuring ticket re-selection behavior aligns with clarified edge cases.

## Technical Context

**Language/Version**: TypeScript 5.9  
**Primary Dependencies**: VS Code Extension API, webpack, @vscode/test-cli  
**Storage**: N/A (in-memory editor mapping and draft state)  
**Testing**: @vscode/test-cli with unit tests  
**Target Platform**: VS Code desktop  
**Project Type**: single  
**Performance Goals**: Ticket reselect switches to target editor within 1 second  
**Constraints**: TypeScript strict mode; unit tests required for behavior changes  
**Scale/Scope**: Dozens of open ticket editors in a single workspace

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- TDD: unit tests written first and confirmed Red before implementation.
- TypeScript strict mode remains enabled; type checks pass.
- DRY: no duplicated business logic without justification.

## Project Structure

### Documentation (this feature)

```text
specs/001-ticket-editor-pinning/
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

**Structure Decision**: Single project with `src/` and `tests/` directories.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | N/A | N/A |
