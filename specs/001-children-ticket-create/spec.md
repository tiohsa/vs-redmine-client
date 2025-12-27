# Feature Specification: childrenメタデータによる子チケット自動登録

**Feature Branch**: `001-children-ticket-create`  
**Created**: 2025-12-28  
**Status**: Draft  
**Input**: User description: "チケット登録時にメタデータにchildren: - 件名1 - 件名2 と書くとチケット登録時にそれらを子チケットとして登録する"

## Clarifications

### Session 2025-12-28

- Q: children に不正/空行が含まれる場合の扱い → A: 不正/空行が1つでもあれば、親も子も作成せず全体を失敗とする
- Q: 子チケット作成の一部失敗時の扱い → A: 子チケット作成で1件でも失敗したら、親も子も作成せず全体を失敗とする
- Q: children の重複件名の扱い → A: 重複件名もすべて子チケットとして作成する
- Q: children の件数上限 → A: 件数上限を設ける（50件）
- Q: children の形式 → A: children の直下はハイフン付きの箇条書きのみ有効（YAML配列形式）

## User Scenarios & Testing *(mandatory)*

**Constitution reminder**: Unit tests are mandatory and must be defined before
implementation. Ensure scenarios can be covered by unit tests.

### User Story 1 - 子チケット一括作成 (Priority: P1)

ユーザーはチケット登録時にメタデータで子チケットの件名一覧を指定し、親チケットと同時に子チケットを作成できる。

**Why this priority**: 親子タスクの分解を一度の登録で完了でき、作業の手間を大きく削減できるため。

**Independent Test**: children に複数件名を指定して作成し、指定件数の子チケットが親に紐付いて作成されることを確認できる。

**Acceptance Scenarios**:

1. **Given** チケット登録が可能な状態, **When** children に複数の件名を指定して作成する, **Then** 親チケットが作成され、その配下に指定件数の子チケットが作成される
2. **Given** 子チケット件名が1件のみの状態, **When** children に1件指定して作成する, **Then** 親チケットが作成され、1件の子チケットが作成される

---

### User Story 2 - 子チケット指定なしの通常作成 (Priority: P2)

ユーザーは children を指定しない場合、従来どおり親チケットのみを作成できる。

**Why this priority**: 既存の作成フローを壊さず、後方互換性を保つため。

**Independent Test**: children を含めずに作成し、子チケットが作成されないことを確認できる。

**Acceptance Scenarios**:

1. **Given** 通常作成が可能な状態, **When** children を指定せずに作成する, **Then** 親チケットのみが作成され、子チケットは作成されない

---

### User Story 3 - 不正なchildren指定の防止 (Priority: P3)

ユーザーは children に不正/空行が含まれるとき、登録が行われず理由を把握できる。

**Why this priority**: 意図しない子チケット作成やエラーの見落としを防ぐため。

**Independent Test**: children に不正/空行を含めて作成を試み、親子ともに作成されないことと理由の通知を確認できる。

**Acceptance Scenarios**:

1. **Given** children に空行や空白のみの行が含まれる状態, **When** children を指定して作成する, **Then** 親子ともに登録は行われず理由がユーザーに提示される
2. **Given** children の形式が不正な状態, **When** children を指定して作成する, **Then** 親子ともに登録は行われず理由がユーザーに提示される
3. **Given** 子チケットの一部作成が失敗する状態, **When** children を指定して作成する, **Then** 親子ともに登録は行われず理由がユーザーに提示される

---

### Edge Cases

- children に重複した件名が含まれる場合、重複分も含めて子チケットが作成される
- children に空行や空白のみの行が含まれる場合、親子ともに作成されず理由が提示される
- children の件数が上限を超える場合、親子ともに作成されず理由が提示される

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: システムはメタデータの children を受付可能でなければならない
- **FR-002**: children はハイフン付きの箇条書き（YAML配列形式）のみを有効な入力形式として受け付けなければならない
- **FR-003**: children に有効な件名（空白を除去した後に1文字以上の文字列）が指定された場合、システムは親チケット作成と同時に指定件数の子チケットを作成しなければならない
- **FR-004**: children が未指定の場合、システムは従来どおり親チケットのみを作成しなければならない
- **FR-005**: children に空行/空白のみの行、または形式不正が1件でも含まれる場合、システムは親子ともに登録を行わず理由をユーザーに提示しなければならない
- **FR-006**: 子チケット作成が成功した場合、ユーザーは親チケットから子チケット一覧を確認できなければならない
- **FR-007**: children に重複した件名が含まれる場合、システムは重複分も含めて子チケットを作成しなければならない
- **FR-008**: 子チケット作成で1件でも失敗する場合、システムは親子ともに登録を行わず理由をユーザーに提示しなければならない
- **FR-009**: children の件数が 50 件を超える場合、システムは親子ともに登録を行わず理由をユーザーに提示しなければならない

Assumptions: children は親チケットと同一の作成コンテキストで作成され、件名はユーザーが入力可能な文字列である。

### Key Entities *(include if feature involves data)*

- **チケット**: 作成対象の課題。親子関係、件名、基本情報を持つ
- **子チケット**: children により指定される件名で作成されるチケット
- **チケットメタデータ**: チケット作成時に付与できる補助情報

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: children を指定した作成の 95% 以上が、指定件数の子チケット作成まで完了する
- **SC-002**: children 未指定での作成の 99% 以上が、親チケットのみで完了する
- **SC-003**: 無効な children の作成試行は 100% が登録されず、ユーザーが理由を把握できる
- **SC-004**: ユーザーの 90% 以上が、初回試行で親子チケット作成を完了できる
