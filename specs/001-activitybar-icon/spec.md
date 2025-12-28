# Feature Specification: Activity Bar アイコン更新

**Feature Branch**: `001-activitybar-icon`  
**Created**: 2025-12-29  
**Status**: Draft  
**Input**: User description: "Activity barのアイコンとして以下のsvgを適用する -------- <svg viewBox=\"0 0 24 24\" xmlns=\"http://www.w3.org/2000/svg\" fill=\"currentColor\"> <path d=\"M4 18h3.5v-5c0-2.48 2.02-4.5 4.5-4.5s4.5 2.02 4.5 4.5v5H20v-3.5c0-4.42-3.58-8-8-8s-8 3.58-8 8V18zM10 18h4v-5c0-1.1-.9-2-2-2s-2 .9-2 2v5z\"/> </svg>"

## User Scenarios & Testing *(mandatory)*

**Constitution reminder**: Unit tests are mandatory and must be defined before
implementation. Ensure scenarios can be covered by unit tests.

### User Story 1 - Activity Bar のアイコンを更新する (Priority: P1)

ユーザーは Activity Bar の TodoEx アイコンが指定された SVG デザインに変更されていることを確認できる。

**Why this priority**: 拡張機能の視認性と統一感を高めるため、最優先で反映する必要がある。

**Independent Test**: Activity Bar のアイコンが指定 SVG と一致することを確認できる。

**Acceptance Scenarios**:

1. **Given** TodoEx の Activity Bar が表示されている, **When** アイコンを確認する, **Then** 指定された SVG の形状で表示される

---

### Edge Cases

- SVG が読み込めない場合は既存のアイコンが表示される

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: システムは Activity Bar のアイコンとして指定された SVG を使用しなければならない
- **FR-002**: 指定された SVG は fill="currentColor" を維持し、テーマに追従しなければならない

### Key Entities *(include if feature involves data)*

- **Activity Bar アイコン**: 拡張機能の Activity Bar に表示される SVG アイコン

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 指定 SVG が Activity Bar に反映されていることを確認できる
- **SC-002**: テーマ変更時にアイコン色が正しく追従する

## Assumptions

- 既存の Activity Bar アイコンファイルを置き換える
