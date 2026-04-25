import { TicketMode } from "./ticketSaveTypes";

export interface FrontmatterControlFields {
  mode?: TicketMode;
  project_id?: number;
  issue_id?: number;
  parent_issue_id?: number;
  draft_id?: string;
  last_synced_at?: string;
  lock_version?: number;
}
