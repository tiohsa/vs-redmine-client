# Data Model: メタデータ先頭配置

## Entities

### EditorDocument

- **Purpose**: エディタ本文の構成要素を表す
- **Fields**:
  - `metadataBlock`: 先頭に配置されるメタデータ領域
  - `subjectLine`: `# ` で始まる件名行
  - `body`: 件名行の後に続く本文
- **Validation Rules**:
  - `metadataBlock` はファイル先頭に配置される
  - `subjectLine` は単一行で `# ` から始まる
  - `body` の空行は保持する

## State Transitions

- 旧形式読み込み時は `subjectLine` が先頭にある状態を許容する
- 保存時は読み込んだ形式を保持する
