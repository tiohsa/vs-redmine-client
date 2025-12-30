# Implementation Plan: Markdown画像リンクの自動アップロード

**Branch**: `001-upload-markdown-images` | **Date**: 2025-12-30 | **Spec**: `specs/001-upload-markdown-images/spec.md`
**Input**: Feature specification from `/specs/001-upload-markdown-images/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

チケット追加/編集およびコメント追加/編集の本文に含まれるMarkdown画像リンクからローカル画像を検出し、保存時にアップロードして本文リンクを置換する。既存の添付権限に従い、権限がない場合は保存は継続しつつアップロード不可を通知する。重複パスは1回だけアップロードし、失敗時は本文保存を完了した上で失敗一覧を提示する。対応形式とサイズ制限はPNG/JPEG/GIF/WebP、10MB以下とする。

## Technical Context

**Language/Version**: TypeScript 5.9  
**Primary Dependencies**: VS Code Extension API, webpack 5, @vscode/test-cli, ESLint  
**Storage**: N/A (Redmine is the system of record)  
**Testing**: @vscode/test-cli with Mocha  
**Target Platform**: VS Code desktop extension  
**Project Type**: single (VS Code extension)  
**Performance Goals**: 5MB以下の単一画像を含む保存が10秒以内に完了  
**Constraints**: 添付追加権限を尊重; PNG/JPEG/GIF/WebPのみ; 1枚10MB以下; 同一パスは1回のみアップロード; 失敗時も本文保存は完了し失敗一覧を提示; 画像数上限は設けない  
**Scale/Scope**: チケット/コメント本文のMarkdown画像リンクのみ対象

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- TDD: unit tests written first and confirmed Red before implementation.
- TypeScript strict mode remains enabled; type checks pass.
- DRY: no duplicated business logic without justification.

## Project Structure

### Documentation (this feature)

```text
specs/001-upload-markdown-images/
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
├── extension.ts
├── redmine/
├── utils/
├── views/
└── test/
```

**Structure Decision**: Single VS Code extension with feature modules under `src/`.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | N/A | N/A |
