import type * as vscode from "vscode";
import type { IssueDetailResult } from "../../redmine/issues";
import type { OfflineNewTicket, OfflineTicketUpdate } from "../../views/offlineSyncStore";
import type { TicketCreateDependencies, TicketSaveDependencies } from "../../views/ticketSync/types";
import type { TicketEditorContent } from "../../views/ticketEditorContent";

export interface SyncContext {
  connectionScope: string;
}

export interface SyncJournal {
  getNewTicket(
    key: { queueId?: string; documentUri?: string },
    scope: string,
  ): OfflineNewTicket | undefined;
  getTicketUpdate(ticketId: number, scope: string): OfflineTicketUpdate | undefined;
  saveNewTicket(operation: Omit<OfflineNewTicket, "queueId"> & { queueId?: string }, scope: string): Promise<OfflineNewTicket>;
  markNewTicket(
    key: { queueId?: string; documentUri?: string },
    updates: Partial<Pick<OfflineNewTicket, "createdIssueId" | "status" | "phase" | "remoteUpdatedAt" | "createdChildIds">>,
    scope: string,
    expectedRevision?: number,
  ): Promise<OfflineNewTicket | undefined>;
  completeNewTicket(
    key: { queueId?: string; documentUri?: string },
    scope: string,
    promotion?: OfflineTicketUpdate & { sourceRevision?: number },
    expectedRevision?: number,
  ): Promise<boolean>;
  markTicketUpdate(
    ticketId: number,
    updates: Partial<Pick<OfflineTicketUpdate, "phase" | "remoteUpdatedAt" | "createdChildIds">>,
    scope: string,
    expectedRevision?: number,
  ): Promise<OfflineTicketUpdate | undefined>;
  completeTicketUpdate(
    ticketId: number,
    scope: string,
    completion?: { canonical: TicketEditorContent; remoteUpdatedAt: string },
    expectedRevision?: number,
  ): Promise<boolean>;
}

export interface DocumentPort {
  rewriteNewTicket(input: {
    documentUri: string;
    ticketId: number;
    projectId?: number;
    replacement: import("../../views/ticketEditorContent").TicketEditorContent;
  }): Promise<boolean>;
  rewriteTicket?(input: {
    documentUri: string;
    ticketId: number;
    projectId?: number;
    replacement: import("../../views/ticketEditorContent").TicketEditorContent;
  }): Promise<boolean>;
  findOpenDocument(uri: string): vscode.TextDocument | undefined;
}

export interface NewTicketLocalStatePort {
  register(input: {
    ticketId: number;
    documentUri?: string;
    projectId?: number;
    connectionScope: string;
  }): void;
  updateDraft(input: {
    ticketId: number;
    canonical: TicketEditorContent;
    remoteUpdatedAt: string;
    connectionScope: string;
  }): void;
}

export interface RemotePort {
  create: TicketCreateDependencies;
  update: TicketSaveDependencies;
  getIssueDetail(ticketId: number): Promise<IssueDetailResult>;
}
