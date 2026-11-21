# app

## Purpose
Wire extension commands, views, editor events, notifications, and synchronization services together.

## File Index
- `browserCommandRegistrations.ts`: Registers browser-opening commands.
- `commandIds.ts`: Defines shared command IDs.
- `commandRegistry.ts`: Composes command registration dependencies and groups.
- `commentCommandRegistrations.ts`: Registers comment commands.
- `commentSyncService.ts`: Queues and synchronizes comments.
- `connectionCommandRegistrations.ts`: Registers connection management commands.
- `dashboardCommandSelection.ts`: Resolves Dashboard selections for commands.
- `dashboardProjectCommands.ts`: Registers project selection and list refresh commands.
- `editorDocumentChangeScheduler.ts`: Schedules document change handling.
- `editorDocumentPreview.ts`: Updates draft preview state from documents.
- `editorEventController.ts`: Coordinates editor events and context.
- `notificationController.ts`: Presents save and sync notifications.
- `outcomePresenter.ts`: Presents synchronization outcomes.
- `presentationPorts.ts`: Defines presentation interfaces for application wiring.
- `registerCommandStub.ts`: Registers unavailable command stubs.
- `saveSyncClassifier.ts`: Classifies document saves.
- `saveSyncExecutor.ts`: Executes save-triggered synchronization.
- `saveSyncQueue.ts`: Debounces and serializes save work.
- `settingsCommandRegistrations.ts`: Registers settings commands.
- `syncCommandRegistrations.ts`: Registers synchronization commands.
- `syncController.ts`: Coordinates editor synchronization and feedback.
- `syncEffects.ts`: Re-exports durable effect policies and types.
- `syncEngine.ts`: Connects ticket and comment synchronization to the coordinator.
- `ticketCommandRegistrations.ts`: Registers ticket editor and preview commands.
- `unsyncedTypes.ts`: Defines unsynced file keys.
- `viewRegistry.ts`: Registers views and presentation adapters.

## Local Rules & Conventions
- Add command registration to the relevant registration module and compose it through `commandRegistry.ts`.
- Keep editor save classification, scheduling, execution, and presentation in their respective modules.
- Use presentation ports for application-to-view interactions and route synchronization through the existing engine and coordinator.
