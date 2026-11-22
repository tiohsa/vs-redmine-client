# verification

## Purpose
Defines static and scenario-based verification metadata and checks. The feature map and driver connect repository features to selectors, conditions, and the reference scenario.

## File Index
- `architecture.test.cjs`: Checks architecture policy and recorded legacy state.
- `driver-cli.cjs`: Runs verification-driver commands and scenarios.
- `feature-map.json`: Maps feature entry points to verification coverage.
- `test-quality-rule.mjs`: Implements static test-quality checks.
- `test-quality.test.cjs`: Exercises the test-quality rule.

## Local Rules & Conventions
- Use contributed command and view IDs in feature `entryPoints` references. Resolve `checks` paths from the repository root.
- Keep architecture fixtures self-contained in the temporary repository built by `architecture.test.cjs`.
- When changing reference scenarios, keep expected results and budgets aligned with `../src/test/referenceVerification.ts`, which records Extension Host observations.
