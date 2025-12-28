# Research: 新規作成エディタのテンプレート設定

## Decision
Use a settings-controlled absolute file path to load the new ticket editor template content (including metadata) and apply it as the initial editor body for new tickets only.

## Rationale
An absolute-path template file is consistent with the existing editor storage path setting pattern, keeps configuration explicit, and supports global reuse across projects.

## Alternatives considered
- Store template content directly in settings (rejected: harder to edit and maintain large content).
- Allow workspace-relative paths (rejected: requirement specifies absolute paths only).
