# Feature Specification: Activity Barメタデータ既定値削除

**Feature Branch**: `[001-remove-activitybar-default]`  
**Created**: 2025-12-29  
**Status**: Draft  
**Input**: User description: "チケットのメタデータのデフォルト値をActivity barのviewの一番上で設定できるが、これを削除する。デフォルト値はファイルに設定できるため不要となった。"

## Clarifications

### Session 2025-12-29

- Q: Activity Bar内の既定値関連UIはどこまで削除するか → A: ビュー上部の既定値UIのみ削除し、ソート/フィルタなど他の設定UIは維持する
- Q: 既定値UI削除の適用範囲はどこか → A: Activity Bar内で既定値UIが表示される全てのビュー
- Q: Activity Barで既定値を表示できるか → A: Activity Barでは既定値を表示しない

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

### User Story 1 - Activity Barから既定値設定をなくす (Priority: P1)

ユーザーとして、Activity Barのビューを開いたときにメタデータの既定値設定が表示されず、重複した設定場所に迷わず作業したい。

**Why this priority**: 既定値設定の場所を一本化し、混乱や誤設定のリスクを下げるため。

**Independent Test**: Activity Barのビューを開き、既定値を設定するためのUI要素が存在しないことを確認できる。

**Acceptance Scenarios**:

1. **Given** Activity Barのビューを表示している, **When** 画面上部を確認する, **Then** メタデータの既定値を設定する入力項目が表示されない
2. **Given** 既定値設定を探しているユーザーがいる, **When** Activity Barを操作する, **Then** 既定値設定への操作導線が存在しない

---

### User Story 2 - ファイルの既定値が優先される (Priority: P2)

ユーザーとして、ファイルに定義したメタデータの既定値がチケット作成時に確実に反映され、Activity Barの表示変更によって既定値が変わらないことを確認したい。

**Why this priority**: 既定値の信頼性を担保し、作業の一貫性を維持するため。

**Independent Test**: 既定値を定義した状態でチケットを作成し、メタデータが期待どおりに初期化されることを確認できる。

**Acceptance Scenarios**:

1. **Given** 既定値がファイルに定義されている, **When** 新規チケットを作成する, **Then** メタデータがその既定値で初期化される
2. **Given** 既定値がファイルに定義されていない, **When** 新規チケットを作成する, **Then** メタデータは空の状態で開始される

---

### Edge Cases

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right edge cases.
-->

- 既定値がファイルで定義されていない場合でも、Activity Barに代替の設定UIが出現しない
- Activity Barで既定値を設定できた過去の利用経験があっても、現行では影響を受けず既定値はファイルのみから決定される
- Activity Bar上部のソート/フィルタなどの設定UIは引き続き利用できる

## Requirements *(mandatory)*

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right functional requirements.
-->

### Functional Requirements

- **FR-001**: Activity Barのビュー上部から、メタデータの既定値を設定するUIを削除すること
- **FR-002**: Activity Barのソート/フィルタなど既定値以外の設定UIは維持されること
- **FR-003**: Activity Barからは、メタデータの既定値を表示・変更できないこと
- **FR-004**: メタデータの既定値はファイルで定義された内容のみを採用すること
- **FR-005**: ファイルに既定値がない場合、メタデータは空の状態で初期化されること
- **FR-006**: 既定値UIの削除はActivity Bar内の全ビューに適用されること

### Key Entities *(include if feature involves data)*

- **メタデータ既定値定義**: ファイルで管理される既定値の集合
- **チケットメタデータ**: チケットに付随する項目群とその初期値

## Assumptions

- 既定値の設定場所はファイルに一本化される
- 既定値が未定義の場合は空で開始することが受け入れられる

## Success Criteria *(mandatory)*

<!--
  ACTION REQUIRED: Define measurable success criteria.
  These must be technology-agnostic and measurable.
-->

### Measurable Outcomes

- **SC-001**: Activity Barのビューで既定値設定UIが表示されないことが100%の確認テストで満たされる
- **SC-002**: 既定値がファイルに定義されたケースで、作成したチケットのメタデータ初期値が100%一致する
- **SC-003**: 既定値が未定義のケースで、作成したチケットのメタデータが100%空で開始する
