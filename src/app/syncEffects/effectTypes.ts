import type { IssueCreateInput, IssueUpdateInput } from "../../redmine/issues";
import type { UploadToken } from "../../redmine/types";

export type DurableSyncEffectKind =
  | "ticket_create"
  | "ticket_update"
  | "child_create"
  | "comment_create"
  | "comment_update"
  | "attachment_upload"
  | "attachment_link"
  | "image_upload"
  | "ticket_delete"
  | "local_finalize";

export type DurableSyncEffectState =
  | "planned"
  | "started"
  | "failed"
  | "committed"
  | "commit_unknown"
  | "compensation_started"
  | "compensated"
  | "compensation_unknown";

export type FailureDisposition = "retryable" | "non_retriable";

export type EffectFailureInfo = {
  disposition: FailureDisposition;
  category?: string;
  detail?: string;
};

export type DurableSyncEffectTarget = {
  ticketId?: number;
  parentTicketId?: number;
  commentId?: number;
  documentUri?: string;
  ordinal?: number;
  subjectHash?: string;
  filePath?: string;
  filename?: string;
  token?: string;
  imageUri?: string;
  replacementUri?: string;
  submittedBody?: string;
};

export type CommentCreateRequestSnapshot = {
  kind: "comment_create";
  request: {
    ticketId: number;
    notes: string;
    uploads?: UploadToken[];
  };
  submittedBody?: string;
  submittedUploads?: Array<{ token: string; filename?: string; contentType?: string }>;
};

export type CommentUpdateRequestSnapshot = {
  kind: "comment_update";
  request: {
    commentId: number;
    notes: string;
    uploads?: UploadToken[];
  };
  submittedBody?: string;
  submittedUploads?: Array<{ token: string; filename?: string; contentType?: string }>;
};

export type AttachmentLinkRequestSnapshot = {
  kind: "attachment_link";
  request: {
    issueId: number;
    fields: { uploads: UploadToken[] };
  };
};

export type TicketCreateRequestSnapshot = {
  kind: "ticket_create";
  request: IssueCreateInput;
};

export type TicketUpdateRequestSnapshot = {
  kind: "ticket_update";
  request: IssueUpdateInput;
};

export type ChildTicketCreateRequestSnapshot = {
  kind: "child_create";
  parentTicketId: number;
  ordinal?: number;
  projectId?: number;
  subject?: string;
  description?: string;
  request: IssueCreateInput;
};

export type UploadRequestSnapshot = {
  kind: "upload";
  filePath?: string;
  filename: string;
  contentType: string;
  contentHash: string;
  contentSize: number;
  imageUri?: string;
  spoolFilePath?: string;
};

export type SyncEffectRequestSnapshot =
  | CommentCreateRequestSnapshot
  | CommentUpdateRequestSnapshot
  | AttachmentLinkRequestSnapshot
  | TicketCreateRequestSnapshot
  | TicketUpdateRequestSnapshot
  | ChildTicketCreateRequestSnapshot
  | UploadRequestSnapshot;

export type DurableSyncEffect = {
  effectId: string;
  kind: DurableSyncEffectKind;
  operationRevision: number;
  attemptGeneration?: number;
  state: DurableSyncEffectState;
  target: DurableSyncEffectTarget;
  requestSnapshot?: SyncEffectRequestSnapshot;
  remoteId?: number;
  token?: string;
  detail?: string;
  failure?: EffectFailureInfo;
};

export type DurableSyncEffectExpectation = {
  operationRevision: number;
  attemptGeneration?: number;
  sourceState: DurableSyncEffectState;
};

export type DurableSyncEffectAction =
  | { kind: "start"; requestSnapshot?: SyncEffectRequestSnapshot }
  | { kind: "start_explicit_retry"; requestSnapshot?: SyncEffectRequestSnapshot }
  | { kind: "commit"; remoteId?: number; token?: string; target?: DurableSyncEffectTarget; requestSnapshot?: SyncEffectRequestSnapshot }
  | { kind: "assume_committed"; remoteId?: number; token?: string; target?: DurableSyncEffectTarget; requestSnapshot?: SyncEffectRequestSnapshot }
  | { kind: "mark_commit_unknown"; detail?: string }
  | { kind: "mark_failed"; detail?: string; disposition?: FailureDisposition; category?: string }
  | { kind: "start_compensation" }
  | { kind: "complete_compensation" }
  | { kind: "mark_compensation_unknown"; detail?: string };
