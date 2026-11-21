# scripts

## Purpose
Contains repository maintenance and verification scripts, including architecture checks, Dashboard UI checks, and the real Redmine test workflow. These scripts orchestrate existing verification targets rather than implementing extension behavior.

## File Index
- `architecture-baseline.json`: Records the existing architecture-check baseline.
- `check-architecture.cjs`: Enforces source architecture rules and baseline accounting.
- `check-dashboard-ui.cjs`: Drives browser-based Dashboard UI checks.
- `clean-test-output.js`: Removes generated test output.
- `redmine-test-env.cjs`: Starts, seeds, tests, or removes the Docker Redmine test environment.
- `run-live-redmine-tests.cjs`: Runs dedicated live suites and records their outcomes.
- `vscode-test-nosandbox.sh`: Runs compile, lint, and VS Code tests with Electron sandbox flags.

## Local Rules & Conventions
- Keep script entry points and environment variable names aligned with `../package.json` and `../docs/development.md`.
- Keep the live runner's upstream restricted to HTTP on loopback. Preserve separate temporary profiles and the shared restart state used by its prepare and resume phases.
- Write live scenario results to the runner's configured report directory. Keep browser checks in `check-dashboard-ui.cjs` tied to the generated Dashboard markup.
