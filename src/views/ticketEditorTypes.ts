import { IssueMetadata } from "./ticketMetadataTypes";

export type TicketEditorKind = "primary" | "extra";
export type TicketEditorContentType = "ticket" | "comment" | "commentDraft";
export type TicketEditorDisplaySource = "draft" | "saved";

export type TicketEditorDefaults = {
  subject: string;
  description: string;
  metadata: IssueMetadata;
};

export interface TicketEditorRecord {
  ticketId: number;
  projectId?: number;
  uri: string;
  kind: TicketEditorKind;
  contentType: TicketEditorContentType;
  lastActiveAt: number;
  displaySource: TicketEditorDisplaySource;
  lastLoadedAt: number;
  commentId?: number;
}
