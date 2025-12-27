# Research: 保存済み状態でのエディタ表示

## Decision 1: 初期表示の優先順位
- **Decision**: 選択時は下書きを優先して表示し、下書きがない場合のみ保存済み内容を表示する。
- **Rationale**: ユーザーの編集中内容を即座に復元でき、作業の連続性を保てる。
- **Alternatives considered**: 常に保存済み内容を表示する（下書きの文脈が失われるため不採用）。

## Decision 2: Reloadの同期方針
- **Decision**: Reloadはチケット単位/コメントの各エディタ単位で実行し、成功時に保存済み内容でエディタ内容を上書きする。
- **Rationale**: 明示的な同期操作でRedmineの最新状態に揃え、ローカル下書きの古さを明確に解消できる。
- **Alternatives considered**: Reload時に上書き/保持を選択させる（操作負荷が増えるため不採用）。

## Decision 3: Reload失敗時の扱い
- **Decision**: Reload失敗時は現在のエディタ内容を保持し、失敗を明示する。
- **Rationale**: 作業中の内容を失わず、再試行の判断材料になる。
- **Alternatives considered**: 空表示や読み取り専用化（作業損失や混乱につながるため不採用）。
