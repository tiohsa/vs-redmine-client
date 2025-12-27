# Research: 更新時のchildren子チケット追加

## Decision 1: 更新時の children の扱い

- **Decision**: 更新時の children は追加のみで、既存の子チケットは変更しない
- **Rationale**: 既存の子チケットの整合性を保ち、意図しない変更を防ぐため
- **Alternatives considered**: 置換 / 追加+削除

## Decision 2: 追加失敗時の原子性

- **Decision**: 子チケット追加で1件でも失敗した場合は更新全体を失敗とする
- **Rationale**: 親子の整合性を保ち、部分更新による混乱を防ぐため
- **Alternatives considered**: 親更新のみ成功 / 失敗分のみ中断

## Decision 3: children 重複の扱い

- **Decision**: 同一更新内の重複は追加しない（理由提示）、過去分は再追加する
- **Rationale**: 同一更新内の意図しない重複作成を防ぎつつ、再追加は許容するため
- **Alternatives considered**: すべて追加 / 既存を再追加禁止

## Decision 4: 更新成功時の children クリア

- **Decision**: 更新成功後、children は自動的に空にする
- **Rationale**: 次回更新での意図しない再追加を防ぐため
- **Alternatives considered**: そのまま保持 / 変更があった場合のみ空にする
