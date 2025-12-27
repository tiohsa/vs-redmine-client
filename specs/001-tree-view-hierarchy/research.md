# Research: 親子関係ツリー表示

## Decision 1: ツリー表示の初期状態
- **Decision**: 初期表示は最上位のみ表示し、子要素は閉じた状態にする。
- **Rationale**: 大規模階層でも視認性を確保し、必要な範囲だけ開けるため。
- **Alternatives considered**: 全階層を展開、深さ2まで展開。

## Decision 2: 既存の並び順との扱い
- **Decision**: 既存の並び順を維持し、階層表示のみ追加する。
- **Rationale**: 既存運用の認知負荷を増やさずに階層構造を示せる。
- **Alternatives considered**: 親の直下に子を再並び替え。

## Decision 3: 親が欠落している項目の扱い
- **Decision**: 親が欠落している項目は最上位として表示する。
- **Rationale**: 一覧から消えることを避け、利用者が把握できるようにする。
- **Alternatives considered**: 非表示、エラー表示のみ。

## Decision 4: 循環参照の扱い
- **Decision**: 循環参照を検知した場合は該当項目で表示を打ち切り、警告を表示する。
- **Rationale**: 無限展開を防止しつつ、異常状態を利用者に明示できる。
- **Alternatives considered**: 警告なしで打ち切り、該当階層を非表示。

## Decision 5: 役割差の扱い
- **Decision**: 役割に関係なく同一のツリー表示を適用する。
- **Rationale**: 役割による差分要件がないため、表示の一貫性を優先する。
- **Alternatives considered**: 役割ごとに表示差を設ける。
