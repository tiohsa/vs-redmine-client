# Implementation Plan: Add Ticket Comment

**Branch**: `002-add-ticket-comment` | **Date**: 2025-12-26 | **Spec**: `specs/002-add-ticket-comment/spec.md`
**Input**: Feature specification from `/specs/002-add-ticket-comment/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Add a command that opens an input prompt to submit a new comment to the
currently selected ticket. The input stays open after submission, clears on
success, preserves text on failure, blocks whitespace-only comments, enforces
Redmine's 20000-character limit with guidance, and refreshes the comment list
after posting.

## Technical Context

**Language/Version**: TypeScript 5.9  
**Primary Dependencies**: VS Code Extension API, webpack, @vscode/test-cli  
**Storage**: N/A (Redmine is the system of record)  
**Testing**: @vscode/test-cli with Mocha  
**Target Platform**: VS Code desktop extension  
**Project Type**: single (VS Code extension)  
**Performance Goals**: comment submissions complete within 5s; updates appear
within 5s  
**Constraints**: explicit command prompt; keep input open after submit; preserve
input on failure; 20000 character limit with guidance  
**Scale/Scope**: per-ticket comments for selected ticket only

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- TDD: unit tests written first and confirmed Red before implementation.
- TypeScript strict mode remains enabled; type checks pass.
- DRY: no duplicated business logic without justification.

## Project Structure

### Documentation (this feature)

```text
specs/002-add-ticket-comment/
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
├── extension.ts
├── redmine/
├── utils/
├── views/
└── test/
```

**Structure Decision**: Single VS Code extension with feature modules under
`src/`.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | N/A | N/A |
