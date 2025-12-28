# Research: ツリー全展開/全折り畳み

## Decision 1: 展開状態の永続保持方式

- Decision: ワークスペース内の永続ストレージを使用して展開状態を保持する
- Rationale: 再起動後も復元要件を満たしつつ、ユーザーの作業文脈を維持できる
- Alternatives considered: セッション中のみ保持（再起動で消える）

## Decision 2: フィルタ/検索時の一括操作対象

- Decision: 現在表示中（フィルタ結果）のノードのみ対象とする
- Rationale: ユーザーが見えている範囲の操作に限定され、意図と一致しやすい
- Alternatives considered: フィルタ外も含む全体操作

## Decision 3: 展開状態の識別キー

- Decision: 既存の一意ID（プロジェクトID/チケットID）を使用する
- Rationale: 同名や表示名変更による衝突を避けられる
- Alternatives considered: 表示名、パス文字列

## Decision 4: フィルタ条件ごとの状態分離

- Decision: 一覧ごとに1つの状態を共有する
- Rationale: 状態管理が単純で、ユーザーにとって一貫性が高い
- Alternatives considered: フィルタ条件ごとに分離、条件変更時にリセット

## Decision 5: 記録上限

- Decision: 1一覧あたり最大5,000ノードまで記録する
- Rationale: 期待する上限規模を満たしつつ、性能要件に合わせた制御が可能
- Alternatives considered: 1,000ノード上限、無制限
