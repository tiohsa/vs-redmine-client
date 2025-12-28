# Implementation Plan: ツリー全展開/全折り畳み

**Branch**: `001-tree-expand-collapse` | **Date**: 2025-09-05 | **Spec**: /home/glorydays/projects/src/ts/todoex/specs/001-tree-expand-collapse/spec.md
**Input**: Feature specification from `/specs/001-tree-expand-collapse/spec.md`

## Summary

プロジェクト一覧・チケット一覧のツリーに全展開/全折り畳み操作を追加し、展開状態をワークスペース内で永続保持する。フィルタ適用時は表示中ノードのみ対象とし、既存の一意IDで状態復元する。

## Technical Context

**Language/Version**: TypeScript 5.9  
**Primary Dependencies**: VS Code Extension API, webpack 5, @vscode/test-cli, ESLint  
**Storage**: VS Code workspace storage (ワークスペース内で永続保持)  
**Testing**: npm test (@vscode/test-cli)  
**Target Platform**: VS Code Extension  
**Project Type**: single (extension)  
**Performance Goals**: 5,000ノードで全展開/全折り畳みが5秒以内  
**Constraints**: 1一覧あたり最大5,000ノードまで記録  
**Scale/Scope**: プロジェクト一覧/チケット一覧の2ビュー

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- TDD: unit tests written first and confirmed Red before implementation.
- TypeScript strict mode remains enabled; type checks pass.
- DRY: no duplicated business logic without justification.

**Post-Phase 1 Re-check**: 設計成果物のみ作成済みのため、違反なし（実装前に再確認）。

## Project Structure

### Documentation (this feature)

```text
specs/001-tree-expand-collapse/
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
