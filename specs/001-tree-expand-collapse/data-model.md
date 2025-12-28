# Data Model: ツリー全展開/全折り畳み

## Entities

### TreeExpandState

- **Purpose**: 一覧種別ごとのツリー展開状態を保持する
- **Fields**:
  - `listType`: 一覧種別（プロジェクト一覧 / チケット一覧）
  - `nodeStates`: ノードごとの状態一覧
  - `lastUpdatedAt`: 最終更新時刻
- **Relationships**:
  - TreeExpandState 1..* → TreeNodeState
- **Validation Rules**:
  - `nodeStates` は最大5,000件まで

### TreeNodeState

- **Purpose**: 単一ノードの展開/折り畳み状態を表す
- **Fields**:
  - `nodeId`: ノード識別キー（既存の一意ID）
  - `expanded`: 展開状態（true/false）
- **Validation Rules**:
  - `nodeId` は一覧内で一意

## State Transitions

- 個別ノードの展開/折り畳み操作で `expanded` が更新される
- 全展開/全折り畳み操作で表示中ノードの `expanded` が一括更新される
- 一覧内容の更新で同一IDの状態を復元し、新規ノードは折り畳み（expanded=false）
