# Implementation Plan: プロジェクト別テンプレート

**Branch**: `001-project-template` | **Date**: 2025-12-26 | **Spec**: /home/glorydays/projects/src/ts/todoex/specs/001-project-template/spec.md
**Input**: Feature specification from `/specs/001-project-template/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Redmineプロジェクト名を含むテンプレートファイルを `redmine-client.editorStorageDirectory/templates` から解決し、該当がなければ既定テンプレートを適用する。照合は大文字小文字を無視した完全一致とし、重複一致時は既定テンプレートへフォールバックする。

## Technical Context

**Language/Version**: TypeScript 5.9
**Primary Dependencies**: VS Code Extension API, webpack 5, @vscode/test-cli, ESLint
**Storage**: Local filesystem (`redmine-client.editorStorageDirectory/templates`)
**Testing**: @vscode/test-cli (`npm test`), ESLint (`npm run lint`)
**Target Platform**: VS Code extension runtime
**Project Type**: single
**Performance Goals**: テンプレート適用までの初期入力反映が5秒以内
**Constraints**: 既定テンプレートが常に利用可能
**Scale/Scope**: ワークスペース規模のプロジェクト数（数十〜数百）

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- TDD: unit tests written first and confirmed Red before implementation.
- TypeScript strict mode remains enabled; type checks pass.
- DRY: no duplicated business logic without justification.

## Project Structure

### Documentation (this feature)

```text
specs/001-project-template/
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
├── models/
├── services/
├── cli/
└── lib/

tests/
├── contract/
├── integration/
└── unit/
```

**Structure Decision**: single project構成（`src/` と `tests/`）に従う。

## Complexity Tracking

No violations.
