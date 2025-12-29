# Implementation Plan: ビュータイトル短縮

**Branch**: `[001-rename-view-titles]` | **Date**: 2025-12-29 | **Spec**: `/home/glorydays/projects/src/ts/todoex/specs/001-rename-view-titles/spec.md`
**Input**: Feature specification from `/specs/001-rename-view-titles/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

サイドバーのビュータイトルを短縮し、「Redmine Projects」「Redmine Tickets」「Redmine Comments」をそれぞれ「Projects」「Tickets」「Comments」に統一する。

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript 5.9  
**Primary Dependencies**: VS Code Extension API, webpack 5, @vscode/test-cli, ESLint  
**Storage**: N/A  
**Testing**: @vscode/test-cli によるユニットテスト  
**Target Platform**: VS Code拡張  
**Project Type**: single  
**Performance Goals**: N/A（表示名の変更が主）  
**Constraints**: TypeScript strict mode維持、ビュータイトルは指定名に統一  
**Scale/Scope**: 3つのビュータイトル変更

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- TDD: unit tests written first and confirmed Red before implementation.
- TypeScript strict mode remains enabled; type checks pass.
- DRY: no duplicated business logic without justification.

Re-check after Phase 1 design: PASS

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
src/

tests/
```

**Structure Decision**: 単一プロジェクト構成（`src/`, `tests/`）

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No constitution violations identified for this plan.

## Phase 0 Output: Research

- `/home/glorydays/projects/src/ts/todoex/specs/001-rename-view-titles/research.md`

## Phase 1 Output: Design & Contracts

- `/home/glorydays/projects/src/ts/todoex/specs/001-rename-view-titles/data-model.md`
- `/home/glorydays/projects/src/ts/todoex/specs/001-rename-view-titles/contracts/README.md`
- `/home/glorydays/projects/src/ts/todoex/specs/001-rename-view-titles/quickstart.md`
