import type { IssueCreateInput, IssueUpdateInput, IssueUploadInput } from "../../redmine/issues";
import type { TicketUpdateFields } from "../../redmine/types";
import type { TicketEditorContent } from "../../views/ticketEditorContent";
import type { TicketCreateRequestSnapshot, TicketUpdateRequestSnapshot } from "../syncEffects";

export type PreparedTicketCreate = {
  parsed: TicketEditorContent;
  projectId: number;
  uploadTokens: IssueUploadInput[];
  imageLinks?: PreparedTicketUpdate["imageLinks"];
  resolved?: any;
  request?: IssueCreateInput;
  snapshot?: TicketCreateRequestSnapshot;
};

export interface PreparedTicketUpdate {
  ticketId: number;
  projectId?: number;
  changes: TicketUpdateFields;
  uniqueChildren: string[];
  imageLinks: Array<{ path: string; range: { start: number; end: number }; resolvedPath: string }>;
  request?: IssueUpdateInput;
  snapshot?: TicketUpdateRequestSnapshot;
  uploadSummary?: any;
  conflictContext?: any;
}
