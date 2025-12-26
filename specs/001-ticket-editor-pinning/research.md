# Research: Ticket Editor Pinning

## Decision: Re-select focus behavior
- **Decision**: When multiple editors exist for the same ticket, re-selecting the ticket focuses the last active editor.
- **Rationale**: Preserves user context and reduces cognitive load when switching between tickets.
- **Alternatives considered**: Always focus the original dedicated editor; prompt user to choose; always open a new editor.

## Decision: Comment draft retention
- **Decision**: Comment drafts remain associated with the ticket and persist across ticket switches, resuming in the same editor.
- **Rationale**: Prevents draft loss and avoids interrupting comment workflows.
- **Alternatives considered**: Prompt to save/discard on switch; discard drafts; block switching while draft exists.

## Decision: Dedicated editor closure behavior
- **Decision**: If a dedicated editor is closed, the next ticket selection opens a new dedicated editor.
- **Rationale**: Aligns with user intent when closing a view and keeps editor management predictable.
- **Alternatives considered**: Keep a hidden instance; prompt to restore or create new.

## Decision: Dedicated editor missing with extra editors open
- **Decision**: If the dedicated editor is closed while extra editors remain, ticket re-selection opens a new dedicated editor without closing existing editors.
- **Rationale**: Keeps explicit extra editors intact while restoring the primary editing surface.
- **Alternatives considered**: Focus an extra editor; close extras and open a new dedicated editor.

## Decision: Extra editor limits
- **Decision**: No explicit limit on the number of extra editors per ticket.
- **Rationale**: Avoids arbitrary constraints and supports varied workflows.
- **Alternatives considered**: Limit to 2 or 3 editors.
