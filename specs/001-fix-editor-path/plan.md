# Implementation Plan: 編集ファイルパス固定設定

**Branch**: `001-fix-editor-path` | **Date**: 2025-12-28 | **Spec**: /home/glorydays/projects/src/ts/todoex/specs/001-fix-editor-path/spec.md
**Input**: Feature specification from `/specs/001-fix-editor-path/spec.md`

## Summary

チケット選択時に開く編集ファイルの保存先ディレクトリを設定で指定できるようにし、指定がない場合は従来通りの保存場所を使用する。設定されたパスが無効な場合はエラー通知し、従来の場所にフォールバックする。

## Technical Context

**Language/Version**: TypeScript 5.9  
**Primary Dependencies**: VS Code Extension API, webpack 5, @vscode/test-cli, ESLint  
**Storage**: N/A (local file system only)  
**Testing**: @vscode/test-cli (unit tests)  
**Target Platform**: VS Code Extension (desktop)  
**Project Type**: Single project  
**Performance Goals**: チケット選択から編集画面表示まで体感1秒以内  
**Constraints**: 設定値はOSの絶対パスとして扱い、無効時は従来の保存場所へフォールバックする  
**Scale/Scope**: チケット編集ファイルの保存パスのみ変更

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- TDD: unit tests written first and confirmed Red before implementation.
- TypeScript strict mode remains enabled; type checks pass.
- DRY: no duplicated business logic without justification.

## Project Structure

### Documentation (this feature)

```text
specs/001-fix-editor-path/
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
├── views/
└── test/
```

**Structure Decision**: Single project structure with settings in `src/config/` and editor handling in `src/views/`.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | N/A | N/A |
