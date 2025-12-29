# Implementation Plan: Activity Barメタデータ既定値削除

**Branch**: `[001-remove-activitybar-default]` | **Date**: 2025-12-29 | **Spec**: `/home/glorydays/projects/src/ts/todoex/specs/001-remove-activitybar-default/spec.md`
**Input**: Feature specification from `/specs/001-remove-activitybar-default/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Activity Bar内のメタデータ既定値UIを全ビューから削除し、既定値はファイル定義のみを適用する。既定値以外のソート/フィルタなどのUIは維持する。

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript 5.9  
**Primary Dependencies**: VS Code Extension API, webpack 5, @vscode/test-cli, ESLint  
**Storage**: ファイル（既定値定義）, その他はN/A  
**Testing**: @vscode/test-cli によるユニットテスト  
**Target Platform**: VS Code拡張  
**Project Type**: single  
**Performance Goals**: N/A（UI要素の削除が主）  
**Constraints**: TypeScript strict mode維持、既定値はファイルのみ  
**Scale/Scope**: Activity Bar内の既定値UI削除（全ビュー）

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

- `/home/glorydays/projects/src/ts/todoex/specs/001-remove-activitybar-default/research.md`

## Phase 1 Output: Design & Contracts

- `/home/glorydays/projects/src/ts/todoex/specs/001-remove-activitybar-default/data-model.md`
- `/home/glorydays/projects/src/ts/todoex/specs/001-remove-activitybar-default/contracts/README.md`
- `/home/glorydays/projects/src/ts/todoex/specs/001-remove-activitybar-default/quickstart.md`
