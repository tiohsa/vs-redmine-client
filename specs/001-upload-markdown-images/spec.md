# Feature Specification: Markdown画像リンクの自動アップロード

**Feature Branch**: `001-upload-markdown-images`  
**Created**: 2025-12-30  
**Status**: Draft  
**Input**: User description: "チケット追加、編集、コメント追加、編集エディタに記載したmarkdownの画僧リンクに紐づく画像をアップロードする機能を追加する。"

## Clarifications

### Session 2025-12-30

- Q: 自動アップロードは既存の添付権限に従うべきか？ → A: 既存の「添付追加」権限を持つユーザーのみ自動アップロード可能
- Q: 権限がない場合の保存挙動はどうするか？ → A: 保存は許可し、リンクは残したままアップロード不可を通知する
- Q: 同一ローカルパスの画像リンクが複数ある場合の扱いは？ → A: 1回だけアップロードし、複数リンクを同一アップロード先に統一する
- Q: 画像アップロード失敗がある場合の保存挙動は？ → A: 本文保存は完了し、失敗一覧を提示する
- Q: 1回の保存での画像数の上限は？ → A: 上限は設けない（サイズ制限のみ）

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

### User Story 1 - 新規作成時の画像自動アップロード (Priority: P1)

ユーザーがチケット新規作成で本文にMarkdownの画像リンクを記載すると、保存時に画像がアップロードされ、本文のリンクがアップロード済み画像を参照する形に置き換わる。

**Why this priority**: 画像付きのチケット作成が最も頻度の高い基本フローであり、手動添付の手間を減らす価値が大きい。

**Independent Test**: 新規作成画面でローカル画像へのMarkdownリンクを含む本文を保存し、添付画像が作成され本文リンクが更新されることで検証できる。

**Acceptance Scenarios**:

1. **Given** 新規作成画面でローカル画像へのMarkdownリンクが含まれる本文がある, **When** 保存する, **Then** 画像がアップロードされ本文のリンクがアップロード先を参照する
2. **Given** 1つ以上の画像リンクが含まれる本文がある, **When** 保存する, **Then** すべての画像がアップロードされ各リンクが更新される

---

### User Story 2 - 既存内容の編集時アップロード (Priority: P2)

ユーザーがチケット本文またはコメントを編集し、ローカル画像へのMarkdownリンクを追加した場合、その画像がアップロードされ、リンクが更新される。

**Why this priority**: 既存チケットの更新でも画像共有は頻繁に起き、編集時の操作性が重要である。

**Independent Test**: 既存チケット/コメントの編集で画像リンクを追加して保存し、添付とリンク更新が行われることで検証できる。

**Acceptance Scenarios**:

1. **Given** 既存の本文にローカル画像リンクを追加した状態, **When** 保存する, **Then** 追加分のみアップロードされ既存の外部リンクは変更されない

---

### User Story 3 - アップロード失敗時の復旧 (Priority: P3)

ユーザーが保存時に画像アップロードに失敗した場合、失敗内容が分かり、再試行やリンク削除で解決できる。

**Why this priority**: 失敗時に原因が分からないと作業が止まるため、最低限の復旧手段が必要。

**Independent Test**: 失敗する画像を含む本文を保存し、失敗内容の表示と再試行/修正の導線が確認できる。

**Acceptance Scenarios**:

1. **Given** アップロードに失敗する画像リンクが含まれる本文, **When** 保存する, **Then** 本文保存は完了し失敗理由と対象の一覧が表示され再試行またはリンク削除が選べる

---

[Add more user stories as needed, each with an assigned priority]

### Edge Cases

- 画像リンクのファイルが存在しない場合
- サポート対象外の拡張子の場合
- 1枚あたりの上限サイズを超える場合
- 同一画像リンクが複数回出現する場合
- オフラインや一時的な接続不良でアップロードできない場合

## Requirements *(mandatory)*

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right functional requirements.
-->

### Functional Requirements

- **FR-001**: システムはチケット追加/編集およびコメント追加/編集の本文からMarkdown画像リンクを検出できること
- **FR-002**: システムはローカルファイルを指す画像リンクを保存時にアップロードし、チケットまたはコメントに画像を関連付けること
- **FR-003**: システムはアップロード完了後に本文内の対象リンクをアップロード済み画像を参照するリンクへ置き換えること
- **FR-004**: システムは既に外部URLを指す画像リンクを変更しないこと
- **FR-005**: システムは複数の画像リンクを含む本文を保存でき、各リンクに対して個別に結果を管理すること
- **FR-006**: システムは対応形式をPNG/JPEG/GIF/WebPとし、1枚あたり10MB以下の画像のみアップロード対象とすること
- **FR-007**: システムはアップロード失敗時に対象画像と理由をユーザーに提示し、再試行またはリンク削除で解決できること
- **FR-008**: システムは既存の「添付追加」権限を持つユーザーのみ自動アップロードを許可すること
- **FR-009**: システムは「添付追加」権限がない場合でも本文の保存を許可し、画像リンクは保持したままアップロード不可を通知すること
- **FR-010**: システムは同一ローカルパスの画像リンクを重複アップロードせず、本文内の複数リンクを同一のアップロード先に統一すること
- **FR-011**: システムは画像アップロードに失敗があっても本文の保存を完了し、失敗対象の一覧と理由を提示すること
- **FR-012**: システムは1回の保存での画像数に上限を設けず、サイズ制限のみを適用すること

### Assumptions

- Markdown画像リンクはユーザー端末のローカルパスを指す場合がある
- 画像は本文の保存処理に合わせてアップロードされる
- 画像以外のファイル（動画・文書など）は対象外とする
- 既存のチケット/コメント保存と画像添付の仕組みが利用可能である

### Key Entities *(include if feature involves data)*

- **Image Asset**: アップロードされた画像本体、サイズ、形式、元リンク情報
- **Markdown Image Reference**: 本文内の画像リンク（元のローカルパスと置き換え後の参照先）
- **Upload Result**: 画像ごとの成否、失敗理由、再試行可否

## Success Criteria *(mandatory)*

<!--
  ACTION REQUIRED: Define measurable success criteria.
  These must be technology-agnostic and measurable.
-->

### Measurable Outcomes

- **SC-001**: 画像リンクを含む保存操作の95%が再試行なしで完了する
- **SC-002**: 5MB以下の単一画像を含む保存が10秒以内に完了する
- **SC-003**: 初回利用者の90%がヘルプなしで画像アップロード付き保存を完了できる
- **SC-004**: 画像添付に関する手動操作のステップ数が現状比で50%削減される
