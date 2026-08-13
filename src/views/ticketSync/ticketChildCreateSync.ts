import type { TicketUpdateFields } from "../../redmine/types";
import type { TicketCreateDependencies, TicketSaveDependencies } from "./types";

export const splitUniqueChildren = (children: string[]): {
  uniqueChildren: string[];
  duplicateChildren: string[];
} => {
  const uniqueChildren: string[] = [];
  const duplicateChildren: string[] = [];
  const seenChildren = new Set<string>();
  children.forEach((child) => {
    if (seenChildren.has(child)) {
      duplicateChildren.push(child);
    } else {
      seenChildren.add(child);
      uniqueChildren.push(child);
    }
  });
  return { uniqueChildren, duplicateChildren };
};

interface ChildCreateParams {
  projectId: number;
  parentId: number;
  subjects: string[];
  fields: TicketUpdateFields;
  createIssue: TicketCreateDependencies["createIssue"] | TicketSaveDependencies["createIssue"];
  deleteIssue: TicketCreateDependencies["deleteIssue"] | TicketSaveDependencies["deleteIssue"];
  description?: string;
  existingChildId?: (input: { ordinal: number; subject: string }) => number | undefined;
  beforeCreate?: (input: { ordinal: number; subject: string }) => Promise<void>;
  afterCreate?: (input: { ordinal: number; subject: string; childId: number }) => Promise<void>;
}

export const createChildTickets = async (params: ChildCreateParams): Promise<{
  createdChildIds: number[];
  error?: string;
  errorCause?: unknown;
  failedOrdinal?: number;
  remoteWriteAttempted?: boolean;
}> => {
  const createdChildIds: number[] = [];
  let ordinal = 0;
  let remoteWriteAttempted = false;
  try {
    for (ordinal = 0; ordinal < params.subjects.length; ordinal++) {
      const childSubject = params.subjects[ordinal];
      const existingChildId = params.existingChildId?.({ ordinal, subject: childSubject });
      if (existingChildId !== undefined) {
        createdChildIds.push(existingChildId);
        continue;
      }
      const dueDate = typeof params.fields.dueDate === "string" ? params.fields.dueDate : undefined;
      remoteWriteAttempted = false;
      await params.beforeCreate?.({ ordinal, subject: childSubject });
      remoteWriteAttempted = true;
      const childId = await params.createIssue({
        projectId: params.projectId,
        subject: childSubject,
        description: params.description ?? "",
        statusId: params.fields.statusId,
        trackerId: params.fields.trackerId,
        priorityId: params.fields.priorityId,
        dueDate,
        parentId: params.parentId,
      });
      if (!childId) {
        throw new Error("Child ticket creation failed.");
      }
      createdChildIds.push(childId);
      await params.afterCreate?.({ ordinal, subject: childSubject, childId });
    }
    return { createdChildIds };
  } catch (error) {
    return {
      createdChildIds,
      error: error instanceof Error ? error.message : "Child ticket creation failed.",
      errorCause: error,
      failedOrdinal: ordinal,
      remoteWriteAttempted,
    };
  }
};
