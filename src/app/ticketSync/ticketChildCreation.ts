import type { IssueCreateInput, createIssue } from "../../redmine/issues";
import { classifyFailureDisposition } from "../../utils/redmineErrors";
import { isRemoteCommitUnknownError } from "../../views/ticketSync/ticketSyncResult";
import { getEffectsForRevision, type ChildTicketCreateRequestSnapshot } from "../syncEffects";
import type { SyncOperationKey, SyncOutcome, UnifiedSyncOperation } from "./syncOperationTypes";
import type { SyncOperationRepository } from "./syncRepositoryTypes";

export type ChildCreationFailure = {
  ok: false;
  commitUnknown: boolean;
  error: Error;
  outcome?: SyncOutcome;
};

export const createTicketChildren = async (input: {
  operation: UnifiedSyncOperation;
  opKey: SyncOperationKey;
  scope: string;
  repo: SyncOperationRepository;
  revision: number;
  uniqueChildren: string[];
  parentTicketId: number;
  projectId: number;
  requireProjectId?: boolean;
  createChild: typeof createIssue;
  onChildWriteFailure?: (ordinal: number, error: Error, commitUnknown: boolean) => Promise<ChildCreationFailure> | undefined;
}): Promise<ChildCreationFailure | undefined> => {
  const {
    operation, opKey, scope, repo, revision, uniqueChildren, parentTicketId, projectId,
    requireProjectId, createChild, onChildWriteFailure,
  } = input;
  for (let ordinal = 0; ordinal < uniqueChildren.length; ordinal++) {
    const subject = uniqueChildren[ordinal];
    const effectId = `child-create:${ordinal}`;

    const currentOp = repo.getOperation(opKey, scope) ?? operation;
    const existingEffect = getEffectsForRevision(currentOp, revision).find((e) => e.effectId === effectId);

    if (existingEffect?.state === "committed" && existingEffect.remoteId) {
      continue;
    }
    if (
      existingEffect?.state === "commit_unknown" ||
      existingEffect?.state === "compensation_unknown" ||
      existingEffect?.state === "compensation_started"
    ) {
      return {
        ok: false,
        commitUnknown: true,
        error: new Error(`Child effect ${effectId} is in uncertain state`),
      };
    }

    const childRequest: IssueCreateInput = {
      subject,
      description: "",
      parentId: parentTicketId,
      projectId,
    };
    const childSnapshot: ChildTicketCreateRequestSnapshot = {
      kind: "child_create",
      parentTicketId,
      projectId,
      subject,
      description: "",
      ordinal,
      request: childRequest,
    };

    const planChild = await repo.planEffect(
      opKey,
      {
        effectId,
        kind: "child_create",
        operationRevision: revision,
        state: "planned",
        target: { parentTicketId, ordinal },
        requestSnapshot: childSnapshot,
      },
      scope,
      revision,
    );
    if (!planChild) {
      return {
        ok: false,
        commitUnknown: false,
        error: new Error(`Failed to plan child effect ${effectId}`),
      };
    }

    const startChild = await repo.transitionEffect(
      opKey,
      effectId,
      { kind: "start", requestSnapshot: childSnapshot },
      scope,
      { operationRevision: revision, sourceState: "planned" },
    );
    if (!startChild) {
      return {
        ok: false,
        commitUnknown: false,
        error: new Error(`Failed to start child effect ${effectId}`),
      };
    }

    if (requireProjectId && (!projectId || projectId <= 0)) {
      throw new Error(`Missing projectId for child issue creation: ${subject}`);
    }

    try {
      const createdChildId = await createChild(childSnapshot.request ?? childRequest);
      if (!createdChildId) {
        throw new Error(`Failed to create child issue: ${subject}`);
      }
      const committedChild = await repo.transitionEffect(
        opKey,
        effectId,
        { kind: "commit", remoteId: createdChildId, requestSnapshot: childSnapshot },
        scope,
        { operationRevision: revision, sourceState: "started" },
      );
      if (!committedChild) {
        await repo.transitionEffect(
          opKey,
          effectId,
          { kind: "mark_commit_unknown" },
          scope,
          { operationRevision: revision, sourceState: "started" },
        );
        return {
          ok: false,
          commitUnknown: true,
          error: new Error(`Child issue created but failed to persist commit checkpoint for ${effectId}`),
        };
      }
    } catch (err) {
      const commitUnknown = isRemoteCommitUnknownError(err);
      const disposition = classifyFailureDisposition(err);
      await repo.transitionEffect(
        opKey,
        effectId,
        commitUnknown ? { kind: "mark_commit_unknown" } : { kind: "mark_failed", detail: (err as Error).message, disposition },
        scope,
        { operationRevision: revision, sourceState: "started" },
      );

      if (onChildWriteFailure) {
        const compensation = onChildWriteFailure(ordinal, err as Error, commitUnknown);
        if (compensation) {
          return compensation;
        }
        continue;
      }
      return {
        ok: false,
        commitUnknown,
        error: err as Error,
      };
    }
  }
  return undefined;
};
