# Phase 0 Research: プロジェクト別テンプレート

## Decision 1: テンプレート判別方法
- Decision: テンプレートファイル名に含まれるプロジェクト名を、大文字小文字を無視した完全一致で判別する。
- Rationale: 表記ゆれを吸収しつつ誤適用を抑え、運用負荷を最小化するため。
- Alternatives considered: 大文字小文字を区別する完全一致、部分一致。

## Decision 2: 競合時の扱い
- Decision: 同一プロジェクト名を含むテンプレートが複数ある場合は既定テンプレートへフォールバックする。
- Rationale: どのテンプレートが正しいかを恣意的に選ばず、誤適用を避けるため。
- Alternatives considered: 最終更新日時優先、ファイル名の辞書順優先。

## Decision 3: 既定テンプレートの識別
- Decision: 既定テンプレートは固定ファイル名（例: default.md）で識別する。
- Rationale: 管理者の理解が容易で、探索コストが最小になるため。
- Alternatives considered: 接頭辞で区別、サブフォルダに分離。

## Decision 4: テンプレート格納場所
- Decision: `redmine-client.editorStorageDirectory/templates` 配下のファイルを対象とする。
- Rationale: 既存のエディタ設定と整合し、ユーザーの管理導線を維持できるため。
- Alternatives considered: プロジェクト配下への格納、別専用ストレージ。
