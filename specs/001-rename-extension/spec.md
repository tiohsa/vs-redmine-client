# Feature Specification: 拡張機能名をRedmine Clientへ変更

**Feature Branch**: `[001-rename-extension]`  
**Created**: 2025-12-29  
**Status**: Draft  
**Input**: User description: "拡張機能の名前をtodoexからredmine clientに変更する"

## Clarifications

### Session 2025-12-29

- Q: 表示名の変更対象はどこまで含めるか → A: 拡張機能一覧、Activity Bar、コマンド表示、READMEなど主要なユーザー向け表示を対象とする

## User Scenarios & Testing *(mandatory)*

<!--
  IMPORTANT: User stories should be PRIORITIZED as user journeys ordered by importance.
  Each user story/journey must be INDEPENDENTLY TESTABLE - meaning if you implement just ONE of them,
  you should still have a viable MVP (Minimum Viable Product) that delivers value.
  
  Assign priorities (P1, P2, P3, etc.) to each story, where P1 is the most critical.
  Think of each story as a standalone slice of functionality that can be:
  - Developed independently
  - Tested independently
  - Deployed independently
  - Demonstrated to users independently
-->

**Constitution reminder**: Unit tests are mandatory and must be defined before
implementation. Ensure scenarios can be covered by unit tests.

### User Story 1 - 表示名がRedmine Clientになる (Priority: P1)

ユーザーとして、拡張機能の表示名が「Redmine Client」と表示され、既存の名称「TodoEx」に混乱しないようにしたい。

**Why this priority**: ユーザー向けの名称を統一し、認知や導線の混乱を避けるため。

**Independent Test**: 拡張機能の表示名が「Redmine Client」であることを確認できる。

**Acceptance Scenarios**:

1. **Given** 拡張機能を確認する場面がある, **When** 名称を表示する, **Then** 「Redmine Client」と表示される
2. **Given** 既存の「TodoEx」表示を参照するユーザーがいる, **When** 画面上の名称を確認する, **Then** 旧名称が表示されない

---

### Edge Cases

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right edge cases.
-->

- 表示名が複数箇所にある場合でも、すべて「Redmine Client」に統一される
- 旧名称「TodoEx」が残っている箇所がない
- コマンド表示やREADMEでも旧名称が残らない

## Requirements *(mandatory)*

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right functional requirements.
-->

### Functional Requirements

- **FR-001**: 拡張機能の表示名は「Redmine Client」となること
- **FR-002**: 拡張機能一覧、Activity Bar、コマンド表示、READMEなど主要なユーザー向け表示で旧名称「TodoEx」が残らないこと

## Assumptions

- 名称の変更対象はユーザー向け表示に限定される

## Success Criteria *(mandatory)*

<!--
  ACTION REQUIRED: Define measurable success criteria.
  These must be technology-agnostic and measurable.
-->

### Measurable Outcomes

- **SC-001**: 主要な表示箇所で拡張機能名が「Redmine Client」と表示されることが100%確認できる
- **SC-002**: 旧名称「TodoEx」がユーザー向け表示に残らないことが100%確認できる
