# syncEffects

## Purpose
Define durable synchronization effects and the policies governing their transitions, retries, and recovery.

## File Index
- `attemptClosure.ts`: Classifies effects and blockers when closing an attempt.
- `attemptGeneration.ts`: Normalizes and reads attempt generations.
- `effectRetry.ts`: Determines whether failed effects can be retried.
- `effectSelection.ts`: Selects effects by revision, generation, and primary role.
- `effectTransition.ts`: Restores and transitions durable effects.
- `effectTypes.ts`: Defines effect states, kinds, targets, snapshots, and failures.
- `recoveryPolicy.ts`: Derives recovery actions and normal-sync blockers.

## Local Rules & Conventions
- Keep state transition decisions in `effectTransition.ts` and recovery decisions in `recoveryPolicy.ts`.
- Reuse selection and generation helpers when evaluating effects; expose shared APIs through `../syncEffects.ts`.
- Keep policy calculations independent of repository persistence and user interface code.
