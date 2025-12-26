# Research: Redmine Ticket Workflow

## Decision 1: Redmine integration surface
- Decision: Use Redmine REST API v6.1 for projects, issues, uploads, and journals.
- Rationale: Matches the requirement for Redmine 6.1 compatibility and avoids
  proprietary dependencies.
- Alternatives considered: Screen scraping or UI automation (rejected as brittle
  and not API-driven).

## Decision 2: Authentication
- Decision: Use Redmine API key authentication.
- Rationale: Common Redmine practice and aligns with clarified requirement.
- Alternatives considered: Username/password or SSO (not required for this
  feature).

## Decision 3: Ticket list behavior
- Decision: Load the latest 50 tickets by default with pagination for more.
- Rationale: Balances responsiveness with completeness and reduces API load.
- Alternatives considered: Load all tickets (risk of slow response and rate
  limits).

## Decision 4: Mermaid conversion rule
- Decision: Convert Markdown ```mermaid blocks into {{mermaid ...}} on submit.
- Rationale: Required for redmica_ui_extension rendering.
- Alternatives considered: Store Mermaid blocks as-is (fails rendering in
  Redmine).

## Decision 5: Comment editing
- Decision: Support editing only the user's own comments using the Redmine
  journal update capability (assume available in Redmine 6.1 or via configured
  plugin support).
- Rationale: Matches clarified scope while keeping permissions predictable.
- Alternatives considered: Append new comments only (does not meet the editing
  requirement).
