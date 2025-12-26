<!--
Sync Impact Report
- Version change: TEMPLATE -> 1.0.0
- Modified principles: N/A (initial adoption)
- Added sections: Core Principles (3 entries), Technology Standards, Development Workflow, Governance
- Removed sections: Core Principles placeholders for Principle 4 and 5 removed
- Templates requiring updates:
  - ✅ .specify/templates/plan-template.md
  - ✅ .specify/templates/spec-template.md
  - ✅ .specify/templates/tasks-template.md
- Follow-up TODOs:
  - TODO(RATIFICATION_DATE): original adoption date unknown
-->
# TodoEx Constitution

## Core Principles

### I. Test-Driven Development (Non-Negotiable)
- Write unit tests before any implementation code.
- Confirm Red (failing tests) before coding, then Green (passing) and Refactor.
- Task completion requires tests for changed behavior to pass.
Rationale: enforces correctness, regression safety, and design clarity.

### II. TypeScript Strict Mode
- TypeScript strict mode MUST remain enabled in `tsconfig.json`.
- Avoid `any`; if unavoidable, scope it tightly and cover with tests.
- Type checks MUST pass for every change.
Rationale: strict typing prevents hidden runtime errors.

### III. DRY (Single Source of Truth)
- Do not duplicate business logic or domain rules.
- If similar logic appears more than twice, extract or justify the duplication.
- Shared behavior must live in one place and be reused.
Rationale: reduces maintenance cost and inconsistency.

## Technology Standards

- Language: TypeScript with strict mode enabled.
- Testing: unit tests are mandatory for behavior changes.
- Use existing project tooling unless a change is explicitly approved.

## Development Workflow

- Start each task by writing a unit test that fails (Red).
- Implement the minimal code to pass tests (Green), then refactor safely.
- Definition of Done includes passing unit tests for the task.

## Governance

- This constitution supersedes all other guidance.
- Amendments require a documented proposal, reviewer approval, and migration notes.
- Versioning follows semantic versioning: MAJOR for breaking governance changes,
  MINOR for new principles or sections, PATCH for clarifications.
- Every PR must confirm compliance with the Core Principles and Workflow.

**Version**: 1.0.0 | **Ratified**: TODO(RATIFICATION_DATE): original adoption date unknown | **Last Amended**: 2025-12-26
