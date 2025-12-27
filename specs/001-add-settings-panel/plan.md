# Implementation Plan: Project List Settings Panel

**Branch**: `001-add-settings-panel` | **Date**: 2025-12-27 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-add-settings-panel/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Add a settings area above the project list that lets users filter and sort tickets by priority, status, tracker, and assignee, plus control due date display windows. Settings apply in-memory to the current list view and update the list immediately without persistence changes.

## Technical Context

**Language/Version**: TypeScript 5.9  
**Primary Dependencies**: VS Code Extension API, webpack, @vscode/test-cli, ESLint  
**Storage**: In-memory state only (no persistence changes)  
**Testing**: @vscode/test-cli with Mocha-based extension tests  
**Target Platform**: VS Code 1.107+  
**Project Type**: Single VS Code extension  
**Performance Goals**: Settings changes reflect in the list without noticeable delay for typical ticket list sizes (<= configured limit).  
**Constraints**: No new persistence or backend changes; must preserve existing list behaviors.  
**Scale/Scope**: Project list sizes up to the configured ticket list limit (default 50).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- TDD: unit tests written first and confirmed Red before implementation.
- TypeScript strict mode remains enabled; type checks pass.
- DRY: no duplicated business logic without justification.

## Project Structure

### Documentation (this feature)

```text
specs/001-add-settings-panel/
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
├── utils/
├── views/
├── extension.ts
└── test/
```

**Structure Decision**: Single VS Code extension project; feature changes live under `src/views/` with shared helpers in existing modules.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
