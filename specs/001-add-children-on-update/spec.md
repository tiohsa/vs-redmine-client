# Feature Specification: 更新時のchildren子チケット追加

**Feature Branch**: `001-add-children-on-update`  
**Created**: 2025-12-28  
**Status**: Draft  
**Input**: User description: "チケットの更新時もchildrenがあれば子チケットを追加する"

## Clarifications

### Session 2025-12-28

- Q: 更新時の children 重複件名の扱い → A: 既存の子と件名が同じでも新規子チケットとして追加する
- Q: 子チケット追加失敗時の更新扱い → A: 子チケット追加が1件でも失敗したら、親チケットの更新も含めて全体を失敗にする
- Q: 更新時の children の扱い → A: 更新時の children は追加のみで、既存の子チケットは変更しない
- Q: 更新時の再追加の扱い → A: 同一更新内の重複のみ防止し、過去に追加済みでも再追加する
- Q: 更新成功時の children クリア → A: 更新成功後に children は自動的に空にする

## User Scenarios & Testing *(mandatory)*

**Constitution reminder**: Unit tests are mandatory and must be defined before
implementation. Ensure scenarios can be covered by unit tests.

### User Story 1 - 更新時の子チケット追加 (Priority: P1)

ユーザーはチケット更新時に children を指定し、既存の親チケットに子チケットを追加できる（既存の子チケットは変更しない）。更新成功後、children は自動的に空になる。

**Why this priority**: 更新作業のタイミングで子タスクを追加できることが主目的であり、作業分解の効率に直結するため。

**Independent Test**: 既存チケットを更新する際に children を指定し、指定件数の子チケットが追加され、既存の子チケットが変更されず、更新後に children が空になることを確認できる。

**Acceptance Scenarios**:

1. **Given** 親チケットが存在する状態, **When** 更新時に children を指定して保存する, **Then** 指定件数の子チケットが親に追加され既存の子チケットは変更されず children が空になる
2. **Given** children を1件指定した状態, **When** 更新して保存する, **Then** 1件の子チケットが追加される
3. **Given** 同一更新内で children に同一件名が含まれる状態, **When** 更新して保存する, **Then** 同一件名は1件のみ追加され理由が提示される

---

### User Story 2 - children 未指定の更新 (Priority: P2)

ユーザーは children を指定しない場合、従来どおり子チケットの追加なしで更新できる。

**Why this priority**: 既存の更新フローを壊さず、後方互換性を保つため。

**Independent Test**: children を含めずに更新し、子チケットが追加されないことを確認できる。

**Acceptance Scenarios**:

1. **Given** 更新が可能な状態, **When** children を指定せずに更新する, **Then** 子チケットは追加されない

---

### User Story 3 - 不正なchildren指定の防止 (Priority: P3)

ユーザーは更新時に children が不正/空行/上限超過/一部失敗の場合、親チケットの更新も含めて失敗し理由を把握できる。

**Why this priority**: 誤った子チケット追加を防ぎ、整合性を保つため。

**Independent Test**: 無効な children を含めて更新し、追加が行われず理由が提示されることを確認できる。

**Acceptance Scenarios**:

1. **Given** children に空行や空白のみの行が含まれる状態, **When** 更新する, **Then** 親チケットの更新も含めて失敗し理由がユーザーに提示される
2. **Given** children の形式が不正な状態, **When** 更新する, **Then** 親チケットの更新も含めて失敗し理由がユーザーに提示される
3. **Given** 子チケットの一部作成が失敗する状態, **When** 更新する, **Then** 親チケットの更新も含めて失敗し理由がユーザーに提示される

---

### Edge Cases

- children に重複した件名が含まれる場合、同一更新内では重複分は追加されず理由が提示される
- children の件数が上限を超える場合、追加は行われず理由が提示される

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: システムは更新時のメタデータ children を受付可能でなければならない
- **FR-002**: children はハイフン付きの箇条書き（YAML配列形式）のみを有効な入力形式として受け付けなければならない
- **FR-003**: children に有効な件名が指定された場合、システムは親チケットの更新時に指定件数の子チケットを追加作成しなければならない（既存の子チケットは変更しない）
- **FR-004**: children が未指定の場合、システムは従来どおり子チケットの追加なしで更新しなければならない
- **FR-005**: children に空行/空白のみの行、または形式不正が1件でも含まれる場合、システムは追加を行わず理由をユーザーに提示しなければならない
- **FR-006**: 子チケット追加が成功した場合、ユーザーは親チケットから子チケット一覧を確認できなければならない
- **FR-007**: children に重複した件名が含まれる場合、システムは同一更新内の重複分を追加せず理由をユーザーに提示しなければならない
- **FR-008**: 子チケット追加で1件でも失敗する場合、システムは親チケットの更新も含めて失敗とし理由をユーザーに提示しなければならない
- **FR-009**: children の件数が 50 件を超える場合、システムは追加を行わず理由をユーザーに提示しなければならない
- **FR-010**: 子チケット追加が成功した場合、システムは更新後に children を自動的に空にしなければならない

Assumptions: children の形式・件数上限は新規作成と同一のルールを適用し、追加は親チケットと同一コンテキストで処理される。

### Key Entities *(include if feature involves data)*

- **チケット**: 更新対象の課題。親子関係、件名、基本情報を持つ
- **子チケット**: children により追加作成されるチケット
- **チケットメタデータ**: チケット更新時に付与できる補助情報

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: children を指定した更新の 95% 以上が、指定件数の子チケット追加まで完了する
- **SC-002**: children 未指定での更新の 99% 以上が、子チケット追加なしで完了する
- **SC-003**: 無効な children の更新試行は 100% が追加されず、ユーザーが理由を把握できる
- **SC-004**: ユーザーの 90% 以上が、初回試行で更新時の子チケット追加を完了できる
