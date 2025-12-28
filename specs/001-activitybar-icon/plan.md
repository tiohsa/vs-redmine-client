# Implementation Plan: Activity Bar アイコン更新

**Branch**: `001-activitybar-icon` | **Date**: 2025-12-29 | **Spec**: /home/glorydays/projects/src/ts/todoex/specs/001-activitybar-icon/spec.md
**Input**: Feature specification from `/specs/001-activitybar-icon/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Replace the TodoEx Activity Bar SVG icon with the provided path data while keeping `fill="currentColor"`, update any related tests to assert the new icon content, and ensure the Activity Bar container continues to point at the updated SVG file.

## Technical Context

**Language/Version**: TypeScript 5.9
**Primary Dependencies**: VS Code Extension API, webpack 5, @vscode/test-cli, ESLint
**Storage**: N/A (static asset update)
**Testing**: @vscode/test-cli (Mocha + Node assert)
**Target Platform**: VS Code 1.107+ extension runtime
**Project Type**: Single extension project
**Performance Goals**: N/A (static asset)
**Constraints**: Keep `fill="currentColor"` in the SVG; retain the existing icon file path in `package.json`.
**Scale/Scope**: Single SVG asset update

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- TDD: unit tests written first and confirmed Red before implementation.
- TypeScript strict mode remains enabled; type checks pass.
- DRY: no duplicated business logic without justification.

## Project Structure

### Documentation (this feature)

```text
specs/001-activitybar-icon/
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

media/
└── todoex-activitybar.svg
```

**Structure Decision**: Single extension project with source under `src/` and assets under `media/`.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | N/A | N/A |
