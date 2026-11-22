# extension-host

## Purpose

Contains features that run in the VS Code Extension Host and the adapters that expose them to VS Code. The reference command demonstrates the route from registration to feature invocation.

## File Index

- `entry-points/`: Registers host-facing entry points. `entry-points/referenceExample.ts` registers the reference command and presents its result.
- `features/`: Contains host feature modules, including the reference example used by verification.

## Local Rules & Conventions

- Register commands in `entry-points/`, using identifiers from `../../contracts/` when a contract defines them.
- Keep registration and host presentation at the entry point. Invoke feature behavior through the feature's public export.
- Attach command registrations to the extension context's subscriptions and compose entry points from `../../extension.ts`.
