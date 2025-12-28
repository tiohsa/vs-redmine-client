# Data Model: 新規作成エディタのテンプレート設定

## Entities

- **新規作成テンプレート**
  - **Attributes**: template file path (absolute), template body (metadata + description)
  - **Scope**: single global template shared across all projects

## Relationships

- The template provides initial values for new ticket editors only.
