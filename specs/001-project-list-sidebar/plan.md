# Implementation Plan: Project List Sidebar

**Branch**: `001-project-list-sidebar` | **Date**: 2025-12-26 | **Spec**: `specs/001-project-list-sidebar/spec.md`
**Input**: Feature specification from `/specs/001-project-list-sidebar/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Add a project list sidebar that shows Redmine project names in a dedicated view.
Users explicitly select a project, which is highlighted and remembered as the
initial selection on startup. The ticket list view updates to show tickets for
that selected project, with clear empty and error states.

## Technical Context

**Language/Version**: TypeScript 5.9  
**Primary Dependencies**: VS Code Extension API, webpack, @vscode/test-cli  
**Storage**: N/A (Redmine is the system of record)  
**Testing**: @vscode/test-cli with Mocha  
**Target Platform**: VS Code desktop extension  
**Project Type**: single (VS Code extension)  
**Performance Goals**: project list loads within 3s; ticket list updates within
3s after selection  
**Constraints**: explicit user selection; separate project/ticket views; remember
last selected project; show errors with retry  
**Scale/Scope**: project lists and ticket lists scoped to current user access

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- TDD: unit tests written first and confirmed Red before implementation.
- TypeScript strict mode remains enabled; type checks pass.
- DRY: no duplicated business logic without justification.

## Project Structure

### Documentation (this feature)

```text
specs/001-project-list-sidebar/
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
