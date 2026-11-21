# ticketSync

## Purpose
Coordinate durable ticket and comment synchronization, including remote effects, reconciliation, and local finalization.

## File Index
- `index.ts`: Re-exports the synchronization API.
- `comment*Handler*.ts`: Implement comment create/update handlers and their dependencies and types.
- `commentUploadEffectRecovery.ts`: Recovers comment upload effects.
- `markdownImageEffects.ts`: Prepares and resolves durable Markdown image uploads.
- `newTicketFinalizer.ts`: Finalizes newly created ticket state.
- `operationHandler*.ts`: Define and collect operation handler contracts.
- `ports.ts`: Defines document, upload, and synchronization ports.
- `resolveIntentBaseDir.ts`: Resolves the base directory of an intent.
- `sync*Repository*.ts`: Define and implement operation persistence and generation fencing.
- `sync*Recovery*.ts`: Resolve uncertain commits, effects, local finalization, and recovery attempts.
- `syncCoordinator.ts`: Orchestrates operations and recovery.
- `syncOperation*.ts`: Define operation models and keys.
- `syncOutcomeTicketId.ts`: Extracts ticket IDs from outcomes.
- `syncPrimaryRemoteTransition.ts`: Applies primary remote-write transitions.
- `syncStateMachine.ts`: Validates lifecycle transitions and restart normalization.
- `syncStoredOperationMapping.ts`: Maps stored queue entries to unified operations.
- `ticketChild*.ts`: Create child tickets and recover their effects.
- `ticketCreate*.ts`: Handle creation, compensation, recovery, and local finalization.
- `ticketHandlerTypes.ts`: Defines prepared ticket handler data.
- `ticketIntentRebase.ts`: Rebases editor content on a new intent.
- `ticketReconciler.ts`: Reconciles ticket state with remote data.
- `ticketRemoteIdentity.ts`: Matches remote tickets and verifies compensation identity.
- `ticketSecondaryEffects.ts`: Executes secondary ticket effects.
- `ticketSync*.ts`: Adapt outcomes and expose ticket synchronization services.
- `ticketUpdate*.ts`: Handle update, recovery, and local finalization.
- `upload*.ts`: Manage frozen upload snapshots, leases, spooling, and cleanup.

## Local Rules & Conventions
- Add operation-specific work through handler contracts and keep orchestration in the coordinator.
- Use repository transition and generation-fence APIs for durable lifecycle changes.
- Keep recovery, remote identity reconciliation, and local finalization separate from ordinary handlers.
