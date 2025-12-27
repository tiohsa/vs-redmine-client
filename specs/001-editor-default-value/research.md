# Research: エディタ初期値設定

## Decisions

- **Decision**: 初期値はインメモリで保持し、永続化は行わない
  - **Rationale**: 既存の方針が「永続化変更なし」であり、仕様でも永続化要件が明示されていないため
  - **Alternatives considered**: 永続設定として保存する（今回はスコープ外）

- **Decision**: 初期値の反映はユーザー操作から1秒以内を目標とする
  - **Rationale**: 設定画面と新規登録の体験を損なわない水準として妥当
  - **Alternatives considered**: 明確なパフォーマンス目標を設定しない

- **Decision**: 初期値管理は利用者ごと・全入力項目対象で統一する
  - **Rationale**: 仕様の明確化済み範囲をそのまま適用し、運用の複雑化を避ける
  - **Alternatives considered**: 共有設定や項目選択制
