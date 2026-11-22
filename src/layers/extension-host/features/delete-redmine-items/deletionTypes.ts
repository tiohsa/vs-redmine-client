export interface DeletionIssueDetail {
  ticket: { id: number; subject: string; parentId?: number };
  comments: Array<{ id: number; ticketId: number; body: string }>;
  childIssueIds?: number[];
}

export interface DeleteProtectionInput {
  connectionScope: string;
  ticketIds: readonly number[];
  commentIds?: readonly number[];
  possibleTicketIds?: readonly number[];
}

export type ProtectedDelete = <T>(input: DeleteProtectionInput, operation: () => Promise<T>) => Promise<T>;

export interface DeletionDependencies {
  getIssueDetail: (ticketId: number, includeChildren?: boolean) => Promise<DeletionIssueDetail>;
  getHttpStatusCode: (error: unknown) => number | undefined;
  getPendingTicketIds: (connectionScope: string) => readonly number[];
}

export interface UnverifiedDescendant {
  ticketId: number;
  unreadableTicketId: number;
}

export type DeleteTarget =
  | { kind: "ticket"; ticketId: number; subject: string; ticketIds: number[]; pendingSnapshot?: number[]; unverified: UnverifiedDescendant[] }
  | { kind: "comment"; ticketId: number; commentId: number; body: string };
