# Feature Specification: ビュータイトル短縮

**Feature Branch**: `[001-rename-view-titles]`  
**Created**: 2025-12-29  
**Status**: Draft  
**Input**: User description: "viewのタイトルを変更する。REDMINE PROJECTSはPROJECTSとする、REDMINE TICKETSはTICKETS。REDMINE COMMENTSはCOMMENTSに変更する"

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

### User Story 1 - ビュー名を短くする (Priority: P1)

ユーザーとして、サイドバーのビュー名が簡潔に表示され、一覧が見やすくなるようにしたい。

**Why this priority**: 主要ビューの視認性と一覧性を高めるため。

**Independent Test**: ビュータイトルが指定の名称に置き換わっていることを確認できる。

**Acceptance Scenarios**:

1. **Given** サイドバーにビュー一覧が表示されている, **When** ビュー名を見る, **Then** 「Redmine Projects」は「Projects」と表示される
2. **Given** サイドバーにビュー一覧が表示されている, **When** ビュー名を見る, **Then** 「Redmine Tickets」は「Tickets」と表示される
3. **Given** サイドバーにビュー一覧が表示されている, **When** ビュー名を見る, **Then** 「Redmine Comments」は「Comments」と表示される

---

### Edge Cases

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right edge cases.
-->

- タイトルの変更対象が複数箇所に存在する場合でも、全て指定の名称に統一される
- 旧名称の「Redmine Projects」「Redmine Tickets」「Redmine Comments」が表示に残らない

## Requirements *(mandatory)*

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right functional requirements.
-->

### Functional Requirements

- **FR-001**: 「Redmine Projects」の表示名は「Projects」となること
- **FR-002**: 「Redmine Tickets」の表示名は「Tickets」となること
- **FR-003**: 「Redmine Comments」の表示名は「Comments」となること

## Assumptions

- 変更対象はビューの表示タイトルのみである

## Success Criteria *(mandatory)*

<!--
  ACTION REQUIRED: Define measurable success criteria.
  These must be technology-agnostic and measurable.
-->

### Measurable Outcomes

- **SC-001**: サイドバー表示で3つのビュー名が全て指定の名称に一致することが100%確認できる
- **SC-002**: 旧名称が表示に残っていないことが100%確認できる
