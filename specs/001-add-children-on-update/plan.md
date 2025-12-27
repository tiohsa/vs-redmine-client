# Implementation Plan: 更新時のchildren子チケット追加

**Branch**: `001-add-children-on-update` | **Date**: 2025-12-28 | **Spec**: /home/glorydays/projects/src/ts/todoex/specs/001-add-children-on-update/spec.md
**Input**: Feature specification from `/specs/001-add-children-on-update/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

チケット更新時に `children` メタデータが指定されている場合、既存の親チケットに子チケットを追加する。更新成功後は `children` を自動的に空にし、同一更新内の重複は追加せず理由を提示する。子追加で1件でも失敗した場合は更新全体を失敗とする。

## Technical Context

**Language/Version**: TypeScript 5.9  
**Primary Dependencies**: VS Code Extension API, webpack 5, @vscode/test-cli, ESLint  
**Storage**: N/A (インメモリのみ、永続化変更なし)  
**Testing**: @vscode/test-cli (vscode-test), Mocha  
**Target Platform**: VS Code 1.107+ 拡張  
**Project Type**: single (VS Code extension)  
**Performance Goals**: children 最大 50 件の追加がユーザー操作上の待ち時間として許容できる範囲で完了する  
**Constraints**: 永続化変更なし、親子は同一更新コンテキストで処理  
**Scale/Scope**: 子チケット最大 50 件

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- TDD: unit tests written first and confirmed Red before implementation.
- TypeScript strict mode remains enabled; type checks pass.
- DRY: no duplicated business logic without justification.

## Project Structure

### Documentation (this feature)

```text
specs/001-add-children-on-update/
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

**Structure Decision**: Single project構成。機能実装は `src/`、テストは `tests/` 配下で管理する。

## Phase 0: Outline & Research

- 仕様で主要な挙動が確定しているため、追加の不明点はなし。
- 研究成果は `research.md` に整理済み。

## Phase 1: Design & Contracts

- データモデルを `data-model.md` に整理。
- 主要な更新フローを OpenAPI 形式で `contracts/` に定義。
- 開発者向け手順を `quickstart.md` に整理。
- エージェントコンテキスト更新を実施済み。

## Constitution Check (Post-Design)

- TDD: unit tests written first and confirmed Red before implementation.
- TypeScript strict mode remains enabled; type checks pass.
- DRY: no duplicated business logic without justification.

## Phase 2: Implementation Planning

- 更新時の children 解析と検証（形式/空行/件数上限/同一更新内重複）
- 既存更新フローに子チケット追加を連動（原子性を保証）
- 失敗理由のユーザー提示
- 更新成功後に children を自動クリア
- ユニットテスト作成（成功/失敗/境界条件）

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
