# Implementation Plan: 親子関係ツリー表示

**Branch**: `001-tree-view-hierarchy` | **Date**: 2025-12-28 | **Spec**: /home/glorydays/projects/src/ts/todoex/specs/001-tree-view-hierarchy/spec.md
**Input**: Feature specification from `/specs/001-tree-view-hierarchy/spec.md`

## Summary

プロジェクト一覧とチケット一覧を親子関係が分かるツリー表示に拡張する。初期表示は最上位のみを表示し、必要に応じて開閉できる。既存の並び順は維持しつつ階層表示のみ追加し、親が欠落している項目は最上位に表示する。循環参照は検知時に該当項目で表示を打ち切り、警告を表示する。

## Technical Context

**Language/Version**: TypeScript 5.9  
**Primary Dependencies**: VS Code Extension API, webpack 5, @vscode/test-cli, ESLint  
**Storage**: N/A (in-memory state only)  
**Testing**: @vscode/test-cli (Mocha)  
**Target Platform**: VS Code desktop 1.107+  
**Project Type**: single (VS Code extension)  
**Performance Goals**: 500件規模の一覧で表示後3秒以内に階層構造を確認できる  
**Constraints**: TypeScript strict mode維持、TDD遵守、既存一覧の並び順を維持  
**Scale/Scope**: プロジェクト一覧とチケット一覧のツリー表示

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- TDD: unit tests written first and confirmed Red before implementation.
- TypeScript strict mode remains enabled; type checks pass.
- DRY: no duplicated business logic without justification.
- Post-design check: No violations identified.

## Project Structure

### Documentation (this feature)

```text
specs/001-tree-view-hierarchy/
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
└── test/
```

**Structure Decision**: Single VS Code extension project。ツリー表示は`src/views/`の一覧ビューを中心に拡張する。

## Complexity Tracking

No constitution violations requiring justification.
