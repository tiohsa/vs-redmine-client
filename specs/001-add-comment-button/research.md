# Research

## Summary

No open technical unknowns were identified for this feature. Existing project conventions and dependencies cover the required changes.

## Decisions

- **Decision**: Reuse the existing add comment flow and permission model.
  **Rationale**: The feature is a new entry point only; reusing existing behavior avoids duplication and aligns with DRY.
  **Alternatives considered**: Creating a separate flow for the header action.

- **Decision**: Keep changes scoped to the comments list header UI and related command wiring.
  **Rationale**: Minimizes impact on the rest of the extension and preserves existing interactions.
  **Alternatives considered**: Expanding to other views or adding new persistence.
