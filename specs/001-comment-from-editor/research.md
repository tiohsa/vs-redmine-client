# Research: Comment from Editor

## Decision 1: Editor-based commands
- Decision: Replace legacy add/edit comment commands with editor-based commands.
- Rationale: Matches clarified requirement to use editor content for add/edit.
- Alternatives considered: Keep legacy commands alongside editor-based ones.

## Decision 2: Validation rules
- Decision: Reject whitespace-only content and enforce 20000 character limit
  with guidance before submission.
- Rationale: Aligns with Redmine constraints and prevents empty submissions.
- Alternatives considered: No length limit or allow empty content.

## Decision 3: Failure handling
- Decision: Preserve editor content on failure and allow retry.
- Rationale: Prevents loss of user input.
- Alternatives considered: Clear content on failure.
