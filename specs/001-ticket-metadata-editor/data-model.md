# Data Model: チケットメタデータ表示・更新

## Entity: Ticket

- Fields:
  - id (string)
  - subject (string)
  - description (string)
  - metadata (IssueMetadata)
- Relationships:
  - Ticket has one IssueMetadata

## Entity: IssueMetadata

- Fields:
  - tracker (string, required, non-empty)
  - priority (string, required, non-empty)
  - status (string, required, non-empty)
  - due_date (string, optional, `YYYY-MM-DD` or empty)
- Validation:
  - Only keys above are allowed (no extra keys)
  - No duplicated keys
  - YAML must parse into `issue` top-level block

## Entity: EditorDocument

- Fields:
  - body (string)
  - metadataBlock (string)
- Validation:
  - Metadata block is bounded by `---` and `---`
  - If block is missing, it is inserted on display

## State Transitions

- Metadata block missing -> inserted on editor display
- Metadata parse failure -> update rejected with validation error
- Metadata updated -> ticket update uses parsed IssueMetadata
