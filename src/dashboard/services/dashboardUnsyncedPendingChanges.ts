import { createHash } from "node:crypto";
import * as vscode from "vscode";
import type { DashboardLocalPendingChange, DashboardUnsyncedItem, DashboardUnsyncedKey } from "../dashboardProtocol";
import { extractCommentBody } from "../../views/commentUpdateFile";
import { sameDocumentIdentity } from "../../views/offlineSyncStore";
import { buildTicketEditorContent, parseTicketEditorContent } from "../../views/ticketEditorContent";
import { getAllEditorRecords } from "../../views/ticketEditorRegistry";
import { collectPendingChangeSnapshots, isRelatedPendingChange, type ChangeSnapshot } from "./dashboardPendingDeletionChanges";

export function pendingChangeFocusId(scope: string, generation: number, id: string): string {
  return createHash("sha256").update(JSON.stringify([scope, generation, id])).digest("hex");
}

function matchesQueueKey(left: DashboardUnsyncedKey, right: DashboardUnsyncedKey): boolean {
  switch (left.kind) {
    case "ticket": return right.kind === "ticket" && left.ticketId === right.ticketId;
    case "newTicket": return right.kind === "newTicket" &&
      (left.queueId !== undefined ? left.queueId === right.queueId : sameDocumentIdentity(left.documentUri, right.documentUri));
    case "comment": return right.kind === "comment" && left.ticketId === right.ticketId &&
      (left.operationId !== undefined ? left.operationId === right.operationId
        : left.commentId !== undefined ? left.commentId === right.commentId
          : sameDocumentIdentity(left.documentUri, right.documentUri));
  }
}

function comparableContent(value: string, comment: boolean): string {
  const normalized = value.replace(/\r\n/g, "\n");
  if (comment) { return extractCommentBody(normalized); }
  try {
    const parsed = parseTicketEditorContent(normalized, { allowEmptyStatus: true });
    return buildTicketEditorContent({ ...parsed, layout: "metadata-first", metadataBlock: "present" });
  } catch {
    return normalized;
  }
}

function sameChange(local: ChangeSnapshot, other: ChangeSnapshot): boolean {
  const sameTarget = (local.key !== undefined && local.key === other.key) ||
    sameDocumentIdentity(local.documentUri, other.documentUri);
  if (!sameTarget || local.content === undefined) { return false; }
  const comment = local.key?.startsWith("comment:") ?? false;
  const candidates = other.queueContents ?? (other.content === undefined ? [] : [other.content]);
  return candidates.some(content => comparableContent(content, comment) === comparableContent(local.content ?? "", comment));
}

function findEditor(scope: string, change: ChangeSnapshot): vscode.TextDocument | undefined {
  if (change.document) { return change.document; }
  if (!change.key || change.content === undefined) { return undefined; }
  const records = getAllEditorRecords().filter(record => record.connectionScope === scope);
  const record = records.find(candidate => {
    const key = candidate.contentType === "commentDraft" || candidate.contentType === "comment"
      ? `comment:${candidate.ticketId}:${candidate.commentId ?? "new"}` : `ticket:${candidate.ticketId}`;
    return key === change.key && vscode.workspace.textDocuments.some(document =>
      sameDocumentIdentity(candidate.uri, document.uri.toString()) &&
      comparableContent(document.getText(), key.startsWith("comment:")) === comparableContent(change.content ?? "", key.startsWith("comment:")));
  });
  return record && vscode.workspace.textDocuments.find(document => sameDocumentIdentity(record.uri, document.uri.toString()));
}

export function buildUnsyncedPendingChanges(scope: string, generation: number, queueItems: DashboardUnsyncedItem[]): {
  items: DashboardUnsyncedItem[];
  local: Array<{ row: DashboardLocalPendingChange; change: ChangeSnapshot; members: ChangeSnapshot[]; editor?: vscode.TextDocument }>;
} {
  const changes = collectPendingChangeSnapshots(scope);
  const items: Array<DashboardUnsyncedItem & { pendingFocusIds: string[] }> =
    queueItems.map(item => ({ ...item, pendingFocusIds: [] }));
  const queue = changes.flatMap(change => {
    const key = change.queueKey;
    const row = key && items.find(item => matchesQueueKey(key, item.key));
    if (!row) { return []; }
    row.pendingFocusIds.push(pendingChangeFocusId(scope, generation, change.id));
    if (change.reference) { row.detail = [row.detail, change.reference].filter(Boolean).join(" · "); }
    if (change.active) { row.inProgress = true; }
    return [{ change, row }];
  });
  const local: ReturnType<typeof buildUnsyncedPendingChanges>["local"] = [];
  for (const change of changes) {
    if (queue.some(entry => entry.change === change)) { continue; }
    const focusId = pendingChangeFocusId(scope, generation, change.id);
    const queued = queue.find(entry => sameChange(change, entry.change));
    if (queued) { queued.row.pendingFocusIds.push(focusId); continue; }
    const existing = local.find(entry => sameChange(change, entry.change));
    if (existing) {
      existing.row.focusIds.push(focusId);
      existing.members.push(change);
      existing.row.id = pendingChangeFocusId(scope, generation,
        `${existing.members.map(member => `${member.id}\0${member.version}`).sort().join("\0")}`);
      continue;
    }
    const editor = findEditor(scope, change);
    const members = [change];
    local.push({ change, members, editor, row: {
      id: pendingChangeFocusId(scope, generation, `${change.id}\0${change.version}`),
      focusIds: [focusId],
      label: change.label,
      detail: change.detail,
      ...(editor ? { open: "editor" } : change.content !== undefined
        ? { open: "preview", reason: vscode.l10n.t("The original editor is unavailable. Open a read-only copy to inspect the change.") }
        : { reason: vscode.l10n.t("The change content is unavailable.") }),
    } });
  }
  for (const entry of local) {
    const storedDrafts = entry.members.every(change =>
      change.id.startsWith("ticket-draft:") || change.id.startsWith("comment-draft:") ||
      change.id.startsWith("comment-edit:"));
    const relatedEditorOrSync = changes.some(candidate => entry.members.some(source =>
      isRelatedPendingChange(source, candidate)) && (candidate.document !== undefined || candidate.active || candidate.draftSyncing));
    entry.row.canDiscard = entry.row.open === "preview" && storedDrafts && !relatedEditorOrSync;
  }
  return { items, local };
}
