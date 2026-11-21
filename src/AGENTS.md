# src

## Purpose

Owns the extension's activation and the code loaded from it. Activation composes the existing application modules and the entry points in the runtime layers.

## File Index

- `extension.ts`: Initializes stores and the upload spool, registers VS Code resources, and responds to configuration changes.
- `contracts/`: Holds shared contracts, currently the command identifier for the reference feature.
- `packages/`: Holds shared infrastructure, currently the cancellable scheduling adapter in `framework-core/index.ts`.

## Local Rules & Conventions

- Keep `extension.ts` focused on composition and resource lifetime. Put command, view, and editor behavior in the modules that activation calls.
- Register VS Code resources with `context.subscriptions` so their lifetime follows the extension.
- When editing connection-change wiring, coordinate store and editor scope switches with the Dashboard reset in the existing configuration listener.
- Use `layers/` for feature entry points and implementations. Use `contracts/` for data shared across runtimes and import adapters through the public `framework-core` entry point.
