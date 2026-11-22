import * as fs from "fs";
import * as vscode from "vscode";
import { getConnectionScopeHash, getCurrentConnectionScope } from "../../config/connectionScope";
import { parseConfiguredProjectId } from "../../config/projectSelection";
import { getDefaultProjectId } from "../../config/settings";
import { refreshTicketEditorContexts } from "../../app/editorEventController";
import { resolveEditorBaseDir } from "../../utils/editorBaseDir";
import { buildNewTicketDraftFilename } from "../../views/editorFilename";
import {
  addOfflineNewTicketAsync,
  getOfflineSyncQueue,
  isAbandoned,
  sameDocumentIdentity,
  type OfflineNewTicket,
} from "../../views/offlineSyncStore";
import { releaseSaveSync, suppressSaveSync } from "../../views/saveSyncSuppression";
import { buildTicketEditorContent, parseTicketEditorContent } from "../../views/ticketEditorContent";
import { getTicketEditorDefaults } from "../../views/ticketEditorDefaultsStore";
import { NEW_TICKET_DRAFT_ID, registerTicketEditor } from "../../views/ticketEditorRegistry";
import {
  applyEditorContent,
  findSubjectTextRange,
  resolveEditorStorageDir,
  withTrailingEditLines,
} from "../../views/ticketPreview";
import type { DashboardUnsyncedKey } from "../dashboardProtocol";
import type { DashboardServiceContext } from "./DashboardServiceContext";

const findActiveDraft = (scope: string, queueId: string, documentUri: string): OfflineNewTicket | undefined =>
  getOfflineSyncQueue(scope).newTickets.find((candidate) => candidate.queueId === queueId &&
    sameDocumentIdentity(candidate.documentUri, documentUri) && !isAbandoned(candidate));

const findOpenDraftDocument = (documentUri: string): vscode.TextDocument | undefined =>
  vscode.workspace.textDocuments.find((doc) => sameDocumentIdentity(doc.uri.toString(), documentUri));

const registerDraftEditor = (
  editor: vscode.TextEditor,
  projectId: number | undefined,
  connectionScope: string,
): void => {
  registerTicketEditor(NEW_TICKET_DRAFT_ID, editor, "primary", "ticket", projectId, connectionScope);
  refreshTicketEditorContexts(editor);
};

const canRefreshQueuedDraft = (entry: OfflineNewTicket): boolean =>
  (entry.phase ?? "queued") === "queued" && !entry.createdIssueId && !entry.disposition &&
  (!entry.effects || entry.effects.length === 0);

const readDraftProjectId = (content: string, fallback: number | undefined): number | undefined => {
  try {
    const parsed = parseTicketEditorContent(content, {
      allowEmptyStatus: true,
      allowMissingMetadata: true,
      allowMissingSubject: true,
      fallbackMetadata: { tracker: "", priority: "", status: "", due_date: "", start_date: "" },
    });
    return parsed.controlFields?.project_id ?? fallback;
  } catch {
    return fallback;
  }
};

const saveFileWithoutSync = async (document: vscode.TextDocument): Promise<void> => {
  const uri = document.uri.toString();
  suppressSaveSync(uri);
  try {
    await document.save();
  } finally {
    releaseSaveSync(uri);
  }
};

export class DashboardDraftService {
  private quickDraftSeq = 0;

  constructor(private readonly deps: {
    context: Pick<DashboardServiceContext, "store" | "notifyError">;
    onDraftCreated: () => void;
    syncDraft: (requestId: string, key: Extract<DashboardUnsyncedKey, { kind: "newTicket" }>) => Promise<void>;
  }) {}

  async createQuickNewTicketDraft(
    requestId: string,
    requestedProjectId?: number,
  ): Promise<void> {
    try {
      const state = this.deps.context.store.getState();
      const projectId =
        requestedProjectId ??
        state.selectedProject?.id ??
        parseConfiguredProjectId(getDefaultProjectId());
      const connectionScope = getCurrentConnectionScope();
      const scopeHash = getConnectionScopeHash(connectionScope);
      const defaults = getTicketEditorDefaults();
      const metadata = {
        tracker:
          defaults.metadata.tracker ||
          state.metadataOptions.trackers[0]?.name ||
          "",
        priority:
          defaults.metadata.priority ||
          state.metadataOptions.priorities[0]?.name ||
          "",
        status:
          defaults.metadata.status ||
          state.metadataOptions.statuses[0]?.name ||
          "",
        assignee: defaults.metadata.assignee || undefined,
        due_date: defaults.metadata.due_date || "",
        start_date: defaults.metadata.start_date || "",
        done_ratio: defaults.metadata.done_ratio ?? 0,
      };
      const subject =
        defaults.subject?.trim() || vscode.l10n.t("Enter new ticket subject");
      const description =
        defaults.description || vscode.l10n.t("Describe the ticket details here.");
      const content = withTrailingEditLines(
        buildTicketEditorContent({
          subject,
          description,
          metadata,
          controlFields: {
            mode: "ticket-create",
            ...(projectId !== undefined ? { project_id: projectId } : {}),
          },
        }),
      );
      const draftId = `draft-${Date.now()}-${++this.quickDraftSeq}`;
      const storageDir = resolveEditorStorageDir({ connectionScope }).uri;
      let fileUri: vscode.Uri;
      if (storageDir) {
        await vscode.workspace.fs.createDirectory(storageDir);
        fileUri = vscode.Uri.joinPath(
          storageDir,
          buildNewTicketDraftFilename(undefined, draftId),
        );
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, "utf8"));
      } else {
        fileUri = vscode.Uri.parse(
          `untitled:${buildNewTicketDraftFilename(scopeHash, draftId)}`,
        );
      }
      const document = await vscode.workspace.openTextDocument(fileUri);
      const editor = await vscode.window.showTextDocument(document, { preview: false });
      if (fileUri.scheme === "untitled") {
        await applyEditorContent(editor, content);
      }
      registerDraftEditor(editor, projectId, connectionScope);
      const subjectRange = findSubjectTextRange(editor.document.getText());
      if (subjectRange) {
        const start = new vscode.Position(subjectRange.line, subjectRange.startChar);
        const end = new vscode.Position(subjectRange.line, subjectRange.endChar);
        editor.selection = new vscode.Selection(start, end);
        editor.revealRange(new vscode.Range(start, end));
      }
      await addOfflineNewTicketAsync(
        {
          content: editor.document.getText(),
          projectId,
          documentUri: editor.document.uri.toString(),
          baseDir: resolveEditorBaseDir({ editor }),
        },
        connectionScope,
      );
      this.deps.onDraftCreated();
    } catch (error) {
      this.deps.context.notifyError(
        requestId,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async openDraftTicket(
    requestId: string,
    queueId: string,
    documentUri: string,
    preserveFocus = false,
  ): Promise<void> {
    const scope = getCurrentConnectionScope();
    const entry = findActiveDraft(scope, queueId, documentUri);
    if (!entry?.documentUri) {
      this.deps.context.notifyError(requestId, vscode.l10n.t("This URI cannot be opened."));
      return;
    }
    const openDoc = findOpenDraftDocument(entry.documentUri);
    let document: vscode.TextDocument;
    let shouldApplyStoredContent = false;
    if (openDoc) {
      document = openDoc;
    } else {
      const uri = vscode.Uri.parse(entry.documentUri);
      if (uri.scheme !== "file" && uri.scheme !== "vscode-userdata" && uri.scheme !== "untitled") {
        this.deps.context.notifyError(requestId, vscode.l10n.t("This URI cannot be opened."));
        return;
      }
      if (uri.scheme === "file" && !fs.existsSync(uri.fsPath)) {
        this.deps.context.notifyError(requestId, vscode.l10n.t("This URI cannot be opened."));
        return;
      }
      document = await vscode.workspace.openTextDocument(uri);
      shouldApplyStoredContent = uri.scheme === "untitled";
    }
    const editor = await vscode.window.showTextDocument(document, {
      preview: false,
      preserveFocus,
    });
    if (
      shouldApplyStoredContent &&
      editor.document.getText().length === 0 &&
      entry.content.length > 0
    ) {
      await applyEditorContent(editor, entry.content);
    }
    registerDraftEditor(editor, entry.projectId, scope);
  }

  async syncDraftTicket(
    requestId: string,
    queueId: string,
    documentUri: string,
  ): Promise<void> {
    const scope = getCurrentConnectionScope();
    const entry = findActiveDraft(scope, queueId, documentUri);
    if (!entry?.documentUri) {
      this.deps.context.notifyError(
        requestId,
        vscode.l10n.t("Queue entry for this new ticket not found."),
      );
      return;
    }
    if (canRefreshQueuedDraft(entry)) {
      const openDoc = findOpenDraftDocument(entry.documentUri);
      if (openDoc) {
        const liveContent = openDoc.getText();
        const latestProjectId = readDraftProjectId(liveContent, entry.projectId);
        if (liveContent !== entry.content || latestProjectId !== entry.projectId) {
          await addOfflineNewTicketAsync(
            {
              content: liveContent,
              projectId: latestProjectId,
              documentUri: entry.documentUri,
              baseDir: entry.baseDir,
              preparationFailure: undefined,
            },
            scope,
          );
        }
        if (openDoc.isDirty && openDoc.uri.scheme === "file") {
          await saveFileWithoutSync(openDoc);
        }
      }
    }
    await this.deps.syncDraft(requestId, {
      kind: "newTicket",
      queueId: entry.queueId,
      documentUri: entry.documentUri,
    });
  }
}
