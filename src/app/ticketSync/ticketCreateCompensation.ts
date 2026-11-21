import type { deleteIssue } from "../../redmine/issues";
import { getAttemptGeneration, getEffectsForRevision, getPrimaryEffectForRevision } from "../syncEffects";
import type { SyncOperationKey, UnifiedSyncOperation } from "./syncOperationTypes";
import type { SyncOperationRepository } from "./syncRepositoryTypes";
import type { ChildCreationFailure } from "./ticketChildCreation";

export const compensateFailedTicketCreation = async (input: {
  operation: UnifiedSyncOperation;
  opKey: SyncOperationKey;
  scope: string;
  repo: SyncOperationRepository;
  revision: number;
  ordinal: number;
  error: Error;
  deleteChildOrParent: typeof deleteIssue;
}): Promise<ChildCreationFailure> => {
  const { operation, opKey, scope, repo, revision, ordinal, error, deleteChildOrParent } = input;
  for (let prev = ordinal - 1; prev >= 0; prev--) {
    const prevEffectId = `child-create:${prev}`;
    const opAfterFail = repo.getOperation(opKey, scope) ?? operation;
    const prevEffect = getEffectsForRevision(opAfterFail, revision).find((e) => e.effectId === prevEffectId);
    if (prevEffect && prevEffect.state === "committed" && prevEffect.remoteId) {
      const startComp = await repo.transitionEffect(
        opKey,
        prevEffectId,
        { kind: "start_compensation" },
        scope,
        { operationRevision: revision, sourceState: "committed" },
      );
      if (startComp) {
        try {
          await deleteChildOrParent(prevEffect.remoteId);
          const childCompResult = await repo.transitionEffect(
            opKey,
            prevEffectId,
            { kind: "complete_compensation" },
            scope,
            { operationRevision: revision, sourceState: "compensation_started" },
          );
          if (!childCompResult) {
            await repo.transitionEffect(
              opKey,
              prevEffectId,
              { kind: "mark_compensation_unknown", detail: "complete_compensation persistence failed after child DELETE" },
              scope,
              { operationRevision: revision, sourceState: "compensation_started" },
            );
          }
        } catch (delErr) {
          await repo.transitionEffect(
            opKey,
            prevEffectId,
            { kind: "mark_compensation_unknown", detail: (delErr as Error).message },
            scope,
            { operationRevision: revision, sourceState: "compensation_started" },
          );
        }
      }
    }
  }

  const opAfterChildren = repo.getOperation(opKey, scope) ?? operation;
  const parentEffect = getPrimaryEffectForRevision(opAfterChildren, revision);
  if (parentEffect && parentEffect.state === "committed" && parentEffect.remoteId) {
    const startParentComp = await repo.transitionEffect(
      opKey,
      "ticket-create",
      { kind: "start_compensation" },
      scope,
      { operationRevision: revision, sourceState: "committed" },
    );
    if (startParentComp) {
      try {
        await deleteChildOrParent(parentEffect.remoteId);
        const compResult = await repo.transitionEffect(
          opKey,
          "ticket-create",
          { kind: "complete_compensation" },
          scope,
          { operationRevision: revision, sourceState: "compensation_started" },
        );
        if (compResult && getAttemptGeneration(compResult) > getAttemptGeneration(operation)) {
          return {
            ok: false,
            error,
            commitUnknown: false,
            outcome: { kind: "queued" },
          };
        }
        if (!compResult) {
          await repo.transitionEffect(
            opKey,
            "ticket-create",
            { kind: "mark_compensation_unknown", detail: "complete_compensation persistence failed after DELETE" },
            scope,
            { operationRevision: revision, sourceState: "compensation_started" },
          );
        }
      } catch (parentDelErr) {
        await repo.transitionEffect(
          opKey,
          "ticket-create",
          { kind: "mark_compensation_unknown", detail: (parentDelErr as Error).message },
          scope,
          { operationRevision: revision, sourceState: "compensation_started" },
        );
      }
    }
  }
  const finalCheck = repo.getOperation(opKey, scope);
  const hasCompUnknown = (finalCheck ? getEffectsForRevision(finalCheck, revision) : []).some(
    (e) => e.state === "compensation_unknown" || e.state === "compensation_started",
  );
  if (hasCompUnknown) {
    return {
      ok: false,
      error,
      commitUnknown: false,
      outcome: {
        kind: "remote_committed",
        ticketId: finalCheck?.createdRemoteId ?? 0,
        pending: "remote_reconcile",
        message: "Compensation failed or persistence failed",
      },
    };
  }
  return {
    ok: false,
    error,
    commitUnknown: false,
  };
};
