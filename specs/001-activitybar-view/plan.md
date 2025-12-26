# Implementation Plan: Activity Bar専用一覧ビュー

**Branch**: `001-activitybar-view` | **Date**: 2025-12-26 | **Spec**: /home/glorydays/projects/src/ts/todoex/specs/001-activitybar-view/spec.md
**Input**: Feature specification from `/specs/001-activitybar-view/spec.md`

## Summary

Activity Barに専用の一覧ビューを追加し、既存エクスプローラーと同じ階層・並びのプロジェクト／チケット／コメント一覧を表示する。専用画面はフォーカス時に自動更新し、空状態は一覧別に表示する。取得失敗時は開発者向け詳細を含むエラーメッセージを出し、2,000件までの一覧表示を著しく遅延なく提供する。

## Technical Context

**Language/Version**: TypeScript 5.9  
**Primary Dependencies**: VS Code Extension API, webpack, @vscode/test-cli  
**Storage**: N/A (in-memory state only)  
**Testing**: @vscode/test-cli (Mocha)  
**Target Platform**: VS Code desktop 1.107+  
**Project Type**: single (VS Code extension)  
**Performance Goals**: フォーカス時の一覧更新から表示まで2秒以内  
**Constraints**: TypeScript strict mode維持、TDD遵守、既存エクスプローラー表示は変更しない  
**Scale/Scope**: 一覧表示は最大2,000件

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- TDD: unit tests written first and confirmed Red before implementation.
- TypeScript strict mode remains enabled; type checks pass.
- DRY: no duplicated business logic without justification.
- Post-design check: No violations identified.

## Project Structure

### Documentation (this feature)

```text
specs/001-activitybar-view/
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

**Structure Decision**: Single VS Code extension project。UIとデータは`src/views/`のツリービューとデータプロバイダを中心に拡張する。

## Complexity Tracking

No constitution violations requiring justification.
