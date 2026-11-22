# layers

## Purpose

Defines the runtime boundaries enforced by the architecture gate. Each runtime owns its entry points and feature implementation.

## File Index

- `webview/`: Reserves browser entry-point and feature directories. The current Dashboard implementation lives in `../dashboard/`.

## Local Rules & Conventions

- Keep runtime dependencies within the same layer. Place cross-runtime message types and identifiers in `../contracts/`.
- Keep VS Code and Node.js APIs in the Extension Host. Use contract messages for Webview requests that need those APIs.
- Resolve dependencies through public feature entry points, shared contracts, or `../packages/framework-core/`. Keep legacy product modules outside the runtime-layer dependency graph.
- Use `scheduleTask` from `framework-core` for delayed work and use its returned callback for cancellation.
- Use statically resolvable module specifiers. The architecture gate checks import, export, and dynamic module references.
