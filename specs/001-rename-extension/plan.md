# Implementation Plan: 拡張機能名をRedmine Clientへ変更

**Branch**: `[001-rename-extension]` | **Date**: 2025-12-29 | **Spec**: `/home/glorydays/projects/src/ts/todoex/specs/001-rename-extension/spec.md`
**Input**: Feature specification from `/specs/001-rename-extension/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

拡張機能の表示名を「TodoEx」から「Redmine Client」へ統一し、拡張機能一覧、Activity Bar、コマンド表示、READMEなど主要なユーザー向け表示に旧名称が残らないようにする。

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
**Constraints**: TypeScript strict mode維持、表示名は「Redmine Client」へ統一  
**Scale/Scope**: 表示名の置換（主要なユーザー向け表示）

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

- `/home/glorydays/projects/src/ts/todoex/specs/001-rename-extension/research.md`

## Phase 1 Output: Design & Contracts

- `/home/glorydays/projects/src/ts/todoex/specs/001-rename-extension/data-model.md`
- `/home/glorydays/projects/src/ts/todoex/specs/001-rename-extension/contracts/README.md`
- `/home/glorydays/projects/src/ts/todoex/specs/001-rename-extension/quickstart.md`
