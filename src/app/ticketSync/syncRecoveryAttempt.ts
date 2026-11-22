import { getAttemptGeneration } from "../syncEffects";
import type { UnifiedSyncOperation } from "./syncOperationTypes";
import type { SyncRecoveryInput } from "./syncRecoveryTypes";

export const matchRecoveryAttempt = (
  operation: UnifiedSyncOperation,
  input: SyncRecoveryInput,
): { ok: true; currentRevision: number; currentAttemptGeneration: number } | { ok: false; error: Error } => {
  const scope = input.context.connectionScope;
  if (operation.connectionScope && operation.connectionScope !== scope) {
    return { ok: false, error: new Error(`Connection scope mismatch: expected "${operation.connectionScope}", got "${scope}"`) };
  }
  if (operation.operationId !== input.operationId) {
    return { ok: false, error: new Error(`Operation ID mismatch: expected "${operation.operationId}", got "${input.operationId}"`) };
  }
  const currentRevision = operation.intentRevision ?? operation.revision ?? 1;
  if (currentRevision !== input.operationRevision) {
    return { ok: false, error: new Error(`Operation revision mismatch: expected ${currentRevision}, got ${input.operationRevision}`) };
  }
  const currentAttemptGeneration = getAttemptGeneration(operation);
  if (currentAttemptGeneration !== input.attemptGeneration) {
    return {
      ok: false,
      error: new Error(`Operation attempt generation mismatch: expected ${currentAttemptGeneration}, got ${input.attemptGeneration}`),
    };
  }
  return { ok: true, currentRevision, currentAttemptGeneration };
};
