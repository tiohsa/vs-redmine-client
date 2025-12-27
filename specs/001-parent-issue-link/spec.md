# Feature Specification: parent_issue_idによる親子登録

**Feature Branch**: `001-parent-issue-link`  
**Created**: 2025-12-28  
**Status**: Draft  
**Input**: User description: "parent_issue_id: [親チケットNo] をメタデータに記述するとその親チケットNoの子チケットとして登録する"

## User Scenarios & Testing *(mandatory)*

**Constitution reminder**: Unit tests are mandatory and must be defined before
implementation. Ensure scenarios can be covered by unit tests.

### User Story 1 - 親チケット指定で子チケット作成 (Priority: P1)

ユーザーはメタデータに親チケット番号を指定して、新規チケットを親子関係付きで登録できる。

**Why this priority**: 親子関係の自動付与が主目的であり、作業の二度手間を防ぐため。

**Independent Test**: 親チケットが存在する状態で parent_issue_id を指定して作成し、子として紐付くことを確認できる。

**Acceptance Scenarios**:

1. **Given** 親チケットが存在しアクセス可能な状態, **When** parent_issue_id を指定してチケットを作成する, **Then** 新規チケットは指定した親の子として登録され、親チケット情報を確認できる
2. **Given** 複数チケットを作成できる状態, **When** それぞれ異なる parent_issue_id を指定して作成する, **Then** 各チケットは対応する親に正しく紐付く

---

### User Story 2 - 親指定なしの通常作成 (Priority: P2)

ユーザーは parent_issue_id を指定しない場合、従来どおり親子関係のないチケットを作成できる。

**Why this priority**: 既存の作成フローを壊さず、後方互換性を保つため。

**Independent Test**: parent_issue_id を含めずに作成し、親子関係が設定されないことを確認できる。

**Acceptance Scenarios**:

1. **Given** 通常作成が可能な状態, **When** parent_issue_id を指定せずにチケットを作成する, **Then** 新規チケットは親なしで登録される

---

### User Story 3 - 不正な親指定の防止 (Priority: P3)

ユーザーは存在しない、またはアクセスできない親チケット番号を指定した場合、登録が行われず理由を把握できる。

**Why this priority**: 誤った親子関係の登録や作業の見落としを防ぐため。

**Independent Test**: 無効な parent_issue_id を指定して作成を試み、登録が行われないことと理由の通知を確認できる。

**Acceptance Scenarios**:

1. **Given** 親チケットが存在しない状態, **When** その番号を parent_issue_id に指定して作成する, **Then** 登録は行われず理由がユーザーに提示される
2. **Given** 親チケットがアクセス不可の状態, **When** その番号を parent_issue_id に指定して作成する, **Then** 登録は行われず理由がユーザーに提示される

---

### Edge Cases

- parent_issue_id が空文字や非数値の場合はどう扱うか？
- parent_issue_id が入力上限桁数を超える場合はどう扱うか？

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: システムはメタデータの parent_issue_id を受付可能でなければならない
- **FR-002**: parent_issue_id が有効な親チケット番号の場合、システムは新規チケットをその親の子として登録しなければならない
- **FR-003**: parent_issue_id が未指定の場合、システムは従来どおり親なしでチケットを登録しなければならない
- **FR-004**: parent_issue_id が無効（存在しない、アクセス不可、形式不正）の場合、システムは登録を行わず理由をユーザーに提示しなければならない
- **FR-005**: 親子登録が成功した場合、ユーザーは新規チケットの親チケット情報を確認できなければならない

Assumptions: parent_issue_id は親チケット番号を表す数値を想定し、親チケットはユーザーが閲覧できる範囲に存在することを前提とする。

### Key Entities *(include if feature involves data)*

- **チケット**: 作成対象の課題。親子関係、識別番号、基本情報を持つ
- **親チケット参照**: parent_issue_id により指定される親チケット番号
- **チケットメタデータ**: チケット作成時に付与できる補助情報

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 有効な parent_issue_id を指定した作成の 95% 以上が、親子関係付きで完了する
- **SC-002**: parent_issue_id 未指定での作成の 99% 以上が、親なしチケットとして完了する
- **SC-003**: 無効な parent_issue_id の作成試行は 100% が登録されず、ユーザーが理由を把握できる
- **SC-004**: ユーザーの 90% 以上が、初回試行で親子チケット作成を完了できる
