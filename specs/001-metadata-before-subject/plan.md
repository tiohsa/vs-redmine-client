# Implementation Plan: メタデータ先頭配置

**Branch**: `001-metadata-before-subject` | **Date**: 2025-12-28 | **Spec**: /home/glorydays/projects/src/ts/todoex/specs/001-metadata-before-subject/spec.md
**Input**: Feature specification from `/specs/001-metadata-before-subject/spec.md`

## Summary

エディタ本文の構成を「メタデータ先頭 → 件名 → 本文」に変更し、旧形式は読み取り互換で扱う。保存時は読み込んだ形式を保持し、本文の空行を保持する。

## Technical Context

**Language/Version**: TypeScript 5.9  
**Primary Dependencies**: VS Code Extension API, webpack 5, @vscode/test-cli, ESLint  
**Storage**: N/A (in-memory)  
**Testing**: npm test (@vscode/test-cli)  
**Target Platform**: VS Code Extension  
**Project Type**: single (extension)  
**Performance Goals**: 既存編集の体感速度を維持（体感遅延なし）  
**Constraints**: 旧形式の保存は形式保持、本文の空行は保持  
**Scale/Scope**: チケットエディタ本文の生成/解析/保存のみ

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- TDD: unit tests written first and confirmed Red before implementation.
- TypeScript strict mode remains enabled; type checks pass.
- DRY: no duplicated business logic without justification.

**Post-Phase 1 Re-check**: 設計成果物のみ作成済みのため、違反なし（実装前に再確認）。

## Project Structure

### Documentation (this feature)

```text
specs/001-metadata-before-subject/
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
