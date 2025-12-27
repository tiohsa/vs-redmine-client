# Implementation Plan: チケットメタデータ表示・更新

**Branch**: `001-ticket-metadata-editor` | **Date**: 2025-12-27 | **Spec**: /home/glorydays/projects/src/ts/todoex/specs/001-ticket-metadata-editor/spec.md
**Input**: Feature specification from `/specs/001-ticket-metadata-editor/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

エディタ内の `---` 区間に YAML 形式のメタデータを表示し、編集内容をチケット更新時に反映する。メタデータは `issue` ブロックのみ許可し、必須項目や形式不備は更新エラーとして扱う。表示名ベースの値を使用し、未指定の期日は空で許容する。

## Technical Context

**Language/Version**: TypeScript 5.9  
**Primary Dependencies**: VS Code Extension API, webpack 5, @vscode/test-cli, ESLint  
**Storage**: N/A（インメモリのみ）  
**Testing**: @vscode/test-cli（Mochaベースの単体テスト）  
**Target Platform**: VS Code Desktop 1.107+  
**Project Type**: single（VS Code拡張）  
**Performance Goals**: メタデータ表示/反映が体感的に即時（通常操作で200ms以内）  
**Constraints**: 永続化なし・外部依存追加なし・YAMLは仕様で定義した構造のみ許可  
**Scale/Scope**: 1チケット/1エディタ、メタデータ行数は10行未満を想定

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- TDD: unit tests written first and confirmed Red before implementation.
- TypeScript strict mode remains enabled; type checks pass.
- DRY: no duplicated business logic without justification.

## Project Structure

### Documentation (this feature)

```text
specs/001-ticket-metadata-editor/
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
├── editors/
└── extension.ts

tests/
├── unit/
└── integration/
```

**Structure Decision**: 既存の単一拡張構成（src/ と tests/）に追加実装する。

## Complexity Tracking

N/A
