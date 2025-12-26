export type TicketEditorKind = "primary" | "extra";
export type TicketEditorContentType = "ticket" | "comment";

export interface TicketEditorRecord {
  ticketId: number;
  uri: string;
  kind: TicketEditorKind;
  contentType: TicketEditorContentType;
  lastActiveAt: number;
}
