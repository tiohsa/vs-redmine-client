# Research: チケット一覧件名更新

## Decision 1: 反映タイミング

- Decision: 保存成功時のみ一覧に反映する
- Rationale: 失敗時の誤表示を避け、要件と一致する
- Alternatives considered: 編集中の即時反映

## Decision 2: 更新範囲

- Decision: 該当チケットの行のみ更新する
- Rationale: 選択状態と並び順を維持しやすい
- Alternatives considered: 一覧全体の再描画

## Decision 3: 空件名の扱い

- Decision: 空件名は保存失敗として扱う
- Rationale: 一覧表示の空白を防ぎ、既存の入力制約に一致する
- Alternatives considered: 空件名の表示、直前値の保持

## Decision 4: 反映先の範囲

- Decision: 現在表示中のチケット一覧のみ更新対象とする
- Rationale: 影響範囲を限定し、最小更新とする
- Alternatives considered: プロジェクト一覧など他の一覧も更新

## Reference Memo: 件名更新の反映条件

- 保存が成功した場合のみ反映する
- 空件名の保存は失敗とするため反映しない
- 一覧更新は該当行のみ（全体再描画なし）
- 反映対象は現在表示中のチケット一覧のみ

## Notes

- 件名が同一の場合は一覧更新を発火しない
- 一覧未表示時は更新通知を送らない
