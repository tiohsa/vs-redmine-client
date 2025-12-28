# Feature Specification: 一覧行のブラウザ表示アイコン追加

**Feature Branch**: `001-open-in-browser`  
**Created**: 2025-12-29  
**Status**: Draft  
**Input**: User description: "プロジェクト一覧、チケット一覧、コメント一覧の各行の右側にブラウザで表示アイコンを追加してクリックするとブラウザで表示するようにする。"

## Clarifications

### Session 2025-12-29

- Q: コメント一覧のアイコンはどこを開く？ → A: 該当コメント位置（アンカー）まで開く
- Q: どの一覧にブラウザ表示アイコンを出す？ → A: Activity Bar の一覧のみ（Explorer には表示しない）
- Q: コメントURLのアンカー形式は？ → A: `issues/<ticketId>#note-<commentId>` を使い、コメントの表示順が取得できる場合はその番号を優先する

## User Scenarios & Testing *(mandatory)*

**Constitution reminder**: Unit tests are mandatory and must be defined before
implementation. Ensure scenarios can be covered by unit tests.

### User Story 1 - 一覧からブラウザで開く (Priority: P1)

ユーザーはプロジェクト、チケット、コメントの各行にあるブラウザ表示アイコンを押して、該当ページを既定ブラウザで開ける。

**Why this priority**: 一覧から即座に詳細へ遷移でき、作業効率が向上するため最優先。

**Independent Test**: 各一覧行のアイコンから正しいURLが開かれることを確認できる。

**Acceptance Scenarios**:

1. **Given** プロジェクト一覧が表示されている, **When** 行のブラウザ表示アイコンを押す, **Then** 該当プロジェクトのページが既定ブラウザで開く
2. **Given** チケット一覧が表示されている, **When** 行のブラウザ表示アイコンを押す, **Then** 該当チケットのページが既定ブラウザで開く
3. **Given** コメント一覧が表示されている, **When** 行のブラウザ表示アイコンを押す, **Then** 該当チケットのコメント位置が既定ブラウザで開く

---

### Edge Cases

- 対象URLが生成できない場合はユーザーに通知し、ブラウザは開かない
- ブラウザ起動に失敗した場合はユーザーに通知する

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: システムはプロジェクト一覧の各行にブラウザ表示アイコンを表示しなければならない
- **FR-002**: システムはチケット一覧の各行にブラウザ表示アイコンを表示しなければならない
- **FR-003**: システムはコメント一覧の各行にブラウザ表示アイコンを表示しなければならない
- **FR-004**: システムはブラウザ表示アイコンのクリックで対応するページを既定ブラウザで開かなければならない
- **FR-005**: システムはURLが生成できない場合、ユーザーに通知しブラウザを開いてはならない
- **FR-006**: システムはブラウザ起動に失敗した場合、ユーザーに通知しなければならない
- **FR-007**: システムはコメント一覧のアイコンで該当コメント位置（アンカー）まで開かなければならない
- **FR-008**: システムはActivity Bar の一覧にのみブラウザ表示アイコンを表示しなければならない
- **FR-009**: システムはコメントURLのアンカーに `issues/<ticketId>#note-<commentId>` を使用し、表示順の番号がある場合はそれを優先しなければならない

### Key Entities *(include if feature involves data)*

- **一覧行アクション**: プロジェクト・チケット・コメントの各行に表示されるブラウザ表示アイコン
- **対象URL**: ブラウザで開くプロジェクト/チケット/コメントのURL

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: プロジェクト、チケット、コメントの各行から該当URLが開けることを確認できる
- **SC-002**: URL生成失敗時にブラウザが開かず通知されることを確認できる
- **SC-003**: ブラウザ起動失敗時に通知されることを確認できる

## Assumptions

- 既存のRedmine URL構成に従って対象URLを生成する
