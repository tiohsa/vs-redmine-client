# Implementation Plan: チケット一覧件名更新

**Branch**: `001-update-ticket-list-subject` | **Date**: 2025-12-28 | **Spec**: /home/glorydays/projects/src/ts/todoex/specs/001-update-ticket-list-subject/spec.md
**Input**: Feature specification from `/specs/001-update-ticket-list-subject/spec.md`

## Summary

チケット登録・更新の保存成功時に、現在表示中のチケット一覧で該当行のみ件名を更新する。選択状態と並び順は維持し、空件名は保存失敗として扱う。

## Technical Context

**Language/Version**: TypeScript 5.9  
**Primary Dependencies**: VS Code Extension API, webpack 5, @vscode/test-cli, ESLint  
**Storage**: N/A (in-memory)  
**Testing**: npm test (@vscode/test-cli)  
**Target Platform**: VS Code Extension  
**Project Type**: single (extension)  
**Performance Goals**: 一覧更新は体感1秒以内  
**Constraints**: 保存成功時のみ反映、該当行のみ更新、並び順と選択状態を維持  
**Scale/Scope**: 現在表示中のチケット一覧のみ

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- TDD: unit tests written first and confirmed Red before implementation.
- TypeScript strict mode remains enabled; type checks pass.
- DRY: no duplicated business logic without justification.

**Post-Phase 1 Re-check**: 設計成果物のみ作成済みのため、違反なし（実装前に再確認）。

## Project Structure

### Documentation (this feature)

```text
specs/001-update-ticket-list-subject/
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

tests/
```

**Structure Decision**: 単一のVS Code拡張プロジェクト構成（`src/`, `tests/`）を維持する。

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | N/A | N/A |
