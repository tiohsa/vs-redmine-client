# Implementation Plan: 新規作成エディタのテンプレート設定

**Branch**: `001-editor-template` | **Date**: 2025-12-29 | **Spec**: /home/glorydays/projects/src/ts/todoex/specs/001-editor-template/spec.md
**Input**: Feature specification from `/specs/001-editor-template/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Add a configurable template file path for new ticket editors, load its contents (including metadata) as the initial editor content, and ensure the template overrides existing defaults while remaining isolated from existing ticket edits.

## Technical Context

**Language/Version**: TypeScript 5.9
**Primary Dependencies**: VS Code Extension API, webpack 5, @vscode/test-cli, ESLint
**Storage**: File-based template content from an absolute path (settings-controlled)
**Testing**: @vscode/test-cli (Mocha + Node assert)
**Target Platform**: VS Code 1.107+ extension runtime
**Project Type**: Single extension project
**Performance Goals**: N/A (local file read)
**Constraints**: Template path must be an absolute path; template applies only to new ticket editors; template overrides existing defaults.
**Scale/Scope**: Single global template used across all projects

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- TDD: unit tests written first and confirmed Red before implementation.
- TypeScript strict mode remains enabled; type checks pass.
- DRY: no duplicated business logic without justification.

## Project Structure

### Documentation (this feature)

```text
specs/001-editor-template/
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

**Structure Decision**: Single extension project with core logic in `src/` and configuration in `package.json`.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | N/A | N/A |
