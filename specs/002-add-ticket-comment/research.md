# Research: Add Ticket Comment

## Decision 1: Comment input UX
- Decision: Use a command that opens an input prompt and keeps it open on success.
- Rationale: Matches clarified UX with minimal UI complexity.
- Alternatives considered: Inline input box in the comment view.

## Decision 2: Submission validation
- Decision: Reject empty or whitespace-only comments and enforce a 20000
  character limit with guidance before submit.
- Rationale: Aligns with Redmine constraints and user clarity.
- Alternatives considered: Allow empty input (rejected).

## Decision 3: Failure handling
- Decision: Preserve input text on failure and allow retry.
- Rationale: Prevents losing user input and supports quick recovery.
- Alternatives considered: Clear input on failure.
