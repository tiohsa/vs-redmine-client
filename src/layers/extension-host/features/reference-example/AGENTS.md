# reference-example

## Purpose

Provides a small Extension Host feature for exercising command registration, public feature imports, and shared scheduling through the verification driver.

## File Index

- `index.ts`: Re-exports the feature operation used by the reference command adapter.
- `internal/`: Implements the scheduled readiness result in `internal/result.ts`.

## Local Rules & Conventions

- Keep the command registration and user notification in `../../entry-points/referenceExample.ts`. The feature supplies the result.
- Keep asynchronous completion in `internal/result.ts` so the reference scenario exercises both dispatch and scheduling.
- Preserve the `ready` result expected by the reference scenario in `../../../../../verification/feature-map.json` and its Extension Host test.
