# Feature Specification: チケット一覧件名更新

**Feature Branch**: `001-update-ticket-list-subject`  
**Created**: 2025-12-28  
**Status**: Draft  
**Input**: User description: "チケット登録・更新時に件名が変わると、チケット一覧の件名と合わなくなるため、チケット一覧の件名を更新する"

## Clarifications

### Session 2025-12-28

- Q: 件名の一覧反映はいつ行うか？ → A: 保存成功時のみ（登録/更新が成功したタイミングで反映）
- Q: 件名更新時の更新範囲は？ → A: 該当チケットの行のみ更新
- Q: 件名が空の場合の扱いは？ → A: 保存に失敗させる
- Q: 件名更新の反映先はどの一覧か？ → A: 現在表示中のチケット一覧のみ

## User Scenarios & Testing *(mandatory)*

**Constitution reminder**: Unit tests are mandatory and must be defined before
implementation. Ensure scenarios can be covered by unit tests.

### User Story 1 - 更新後の件名が一覧に反映される (Priority: P1)

ユーザーはチケットの登録・更新後にチケット一覧を見たとき、件名が最新の値で表示される。

**Why this priority**: 一覧と実データの不一致は混乱を招くため、最優先で解消する必要がある。

**Independent Test**: 件名を変更して保存後、一覧の表示名が新しい件名になっていることを確認できる。

**Acceptance Scenarios**:

1. **Given** チケットの件名を変更した, **When** 保存が完了する, **Then** チケット一覧の件名が更新後の値になる
2. **Given** 新規チケットを登録した, **When** 一覧に表示される, **Then** 登録した件名で表示される

---

### User Story 2 - 一覧の並びや選択状態を維持 (Priority: P2)

ユーザーは件名更新の反映後も、一覧の並びや選択状態が維持される。

**Why this priority**: 不要な再読み込みや選択リセットがあると操作性が低下するため。

**Independent Test**: 変更反映後に、一覧の並びと選択状態が変化しないことを確認できる。

**Acceptance Scenarios**:

1. **Given** 一覧で特定チケットを選択している, **When** 件名更新が反映される, **Then** 選択状態が維持される

---

### Edge Cases

- 件名が空文字の場合は保存に失敗し、一覧は更新されない
- 更新失敗時は一覧の件名を変更しない
- 同じ件名に変更された場合は一覧が変化しない

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: システムはチケット登録・更新後に一覧表示の件名を最新値に更新しなければならない
- **FR-006**: 一覧の件名更新は保存成功時のみ行わなければならない
- **FR-007**: 件名更新は該当チケットの行のみを更新しなければならない
- **FR-008**: 件名更新の反映先は現在表示中のチケット一覧に限定しなければならない
- **FR-002**: システムは件名更新による一覧の並び順変更を行ってはならない
- **FR-003**: システムは件名更新時に選択状態を維持しなければならない
- **FR-004**: 件名が空文字の場合、保存を失敗させなければならない
- **FR-005**: 更新失敗時、一覧の件名を変更してはならない

### Key Entities *(include if feature involves data)*

- **チケット一覧項目**: 一覧上のチケット表示行（件名を含む）
- **チケット件名**: チケットの表示名となる文字列

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 件名更新後に一覧の件名が一致する割合が99%以上
- **SC-002**: 件名更新反映後に選択状態が維持される割合が100%
- **SC-003**: 更新失敗時に一覧が誤更新される割合が0%
- **SC-004**: 登録・更新後に一覧表示が反映されるまでの体感待ち時間が1秒以内

## Assumptions

- 一覧は更新後に全再読み込みではなく最小限の更新で済ませる
- 件名の空文字入力は保存エラーとして扱う
