# Feature Specification: 保存済み状態でのエディタ表示

**Feature Branch**: `[001-show-saved-editor]`  
**Created**: 2025-12-27  
**Status**: Draft  
**Input**: User description: "チケットやコメントを選択したら開くエディタは保存前の状態で表示されるのを保存済の状態でエディタを表示する。"

## Clarifications

### Session 2025-12-27

- Q: 下書きがある場合の初期表示はどうするか → A: 下書きを表示する（必要時はReloadでRedmineと同期する）
- Q: Reload 時の下書きの扱いはどうするか → A: 下書きを上書きして保存済み内容に置き換える（チケット/コメントの各エディタ単位で実行）
- Q: Reload 失敗時の扱いはどうするか → A: エディタ内容を保持する

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

### User Story 1 - 保存済み内容の即時表示 (Priority: P1)

ユーザーがチケットまたはコメントを選択したとき、下書きがあれば下書きを、なければ保存済みの内容を表示する。

**Why this priority**: 選択時に保存済み内容が表示されないと、誤解や誤編集につながるため最優先。

**Independent Test**: 下書きが存在するアイテムでは下書きが表示され、下書きがない場合は保存済み内容が表示されることを確認できる。

**Acceptance Scenarios**:

1. **Given** チケットに保存済み内容と未保存の下書きがある, **When** チケットを選択する, **Then** エディタには下書きが表示される
2. **Given** コメントに保存済み内容のみがある, **When** コメントを選択する, **Then** エディタには保存済み内容が表示される
3. **Given** 保存済み内容の取得に失敗する, **When** チケットまたはコメントを選択する, **Then** エディタは取得失敗が分かる表示になる
4. **Given** チケットAを表示中にチケットBへ切り替える, **When** チケットBを選択する, **Then** エディタはチケットBの保存済み内容を表示する
5. **Given** 下書きがあるチケットのエディタで Reload を実行する, **When** Reload が成功する, **Then** エディタ内容は保存済み内容に置き換わる
6. **Given** 下書きがあるコメントのエディタで Reload を実行する, **When** Reload が成功する, **Then** エディタ内容は保存済み内容に置き換わる

### Edge Cases

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right edge cases.
-->

- 保存済み内容の取得に失敗した場合、エディタは取得失敗が分かる表示になる
- 連続して別のチケット/コメントを素早く選択した場合でも、選択中のアイテムの保存済み内容が表示される
- 保存中のアイテムを選択した場合、最後に保存が成功した内容が表示される
- Reload 実行中に別アイテムを選択した場合、選択中アイテムの表示が優先される
- Reload 失敗時はエディタ内容を保持し、失敗が分かる表示になる

## Requirements *(mandatory)*

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right functional requirements.
-->

### Functional Requirements

- **FR-001**: システムは、チケットまたはコメントの選択時に、下書きがあれば下書きを、なければ保存済み内容をエディタへ表示しなければならない
- **FR-002**: システムは、選択時に下書き表示を優先し、保存済み内容がある場合でも自動で上書きしてはならない
- **FR-003**: システムは、別アイテムを選択したときにエディタ表示を選択中アイテムの保存済み内容へ更新しなければならない
- **FR-004**: システムは、保存済み内容の取得に失敗した場合、保存済み内容が表示できないことを明示しなければならない
- **FR-005**: システムは、保存済み内容がある場合は最後に保存が成功した内容を表示しなければならない
- **FR-006**: システムは、Reload 操作で保存済み内容を再取得し、Redmine と同期できるようにしなければならない
- **FR-007**: システムは、Reload をチケット単位またはコメントのエディタ単位で実行できなければならない
- **FR-008**: システムは、Reload 成功時にエディタ内容を保存済み内容で上書きしなければならない
- **FR-009**: システムは、Reload 失敗時にエディタ内容を保持し、失敗が分かる表示をしなければならない

### Key Entities *(include if feature involves data)*

- **チケット**: 保存済み本文、更新日時、識別子を持つ項目
- **コメント**: 保存済み本文、更新日時、識別子を持つ項目
- **下書き**: 未保存の編集内容、対象アイテムの識別子、作成日時
- **エディタ表示**: 現在表示している本文と対象アイテムの参照

### Assumptions

- 保存済み内容は選択時に参照できる
- 下書きは保存済み内容とは独立して保持され、表示切替に自動適用されない
- 下書きを再開する操作は本機能の範囲外とする
- Reload は明示的な操作として提供される
- Reload 成功時は下書きが保存済み内容で置き換わる

### Dependencies

- チケット/コメントの保存済み内容を取得できるデータソースが利用可能である

## Success Criteria *(mandatory)*

<!--
  ACTION REQUIRED: Define measurable success criteria.
  These must be technology-agnostic and measurable.
-->

### Measurable Outcomes

- **SC-001**: 下書きが存在する場合、選択時に下書きが表示される割合が 100% である
- **SC-002**: チケット/コメントを選択してから 1 秒以内に保存済み内容が表示される
- **SC-003**: 「保存前の内容が表示される」ことに関する問い合わせが 80% 以上減少する
- **SC-004**: Reload 実行時に保存済み内容へ更新される割合が 100% である
