import type { DashboardServiceContext } from "./DashboardServiceContext";
import * as vscode from "vscode";
import { getProjectTrackers } from "../../redmine/projects";
import { getIssueAllowedStatuses } from "../../redmine/issues";
import { ensureTicketDraft, markDraftStatus, setTicketDraftContent } from "../../views/ticketDraftStore";
import { getOfflineSyncQueue, addOfflineTicketUpdate } from "../../views/offlineSyncStore";
import { buildTicketDetail } from "../viewModels/ticketDashboardViewModel";
import { buildTicketEditorContent, parseTicketEditorContent, type TicketEditorContent } from "../../views/ticketEditorContent";
import { getTicketEditors, registerTicketDocument } from "../../views/ticketEditorRegistry";
import { applyEditorContent } from "../../views/ticketPreview";
import type { Ticket } from "../../redmine/types";
import type { TicketMetadataPatch } from "../dashboardProtocol";

export class DashboardMetadataService {
  private readonly projectTrackerCache = new Map<number, Array<{ id: number; name: string }>>();

  constructor(private readonly deps: {
    context: DashboardServiceContext;
    getTickets: () => Ticket[];
    isMetadataOptionsLoaded: () => boolean;
    refreshUnsynced: () => void;
    pushTickets: () => void;
    openEditor: (ticketId: number) => Promise<void>;
  }) {}

  async loadEditOptions(ticketId: number, projectId: number): Promise<void> {
    const { store } = this.deps.context;
    store.update({
      editOptions: {
        ticketId,
        projectId,
        trackers: [],
        priorities: [],
        statuses: [],
        statusFallback: false,
        loading: true,
      },
    });
    const globalOptions = store.getState().metadataOptions;
    try {
      const [trackers, allowedStatuses] = await Promise.all([
        getProjectTrackers(projectId),
        getIssueAllowedStatuses(ticketId).catch(() => null),
      ]);
      this.projectTrackerCache.set(projectId, trackers);
      const statusFallback = allowedStatuses === null || allowedStatuses.length === 0;
      const statuses = !statusFallback ? allowedStatuses! : globalOptions.statuses;
      store.update({
        editOptions: {
          ticketId,
          projectId,
          trackers,
          priorities: globalOptions.priorities,
          statuses,
          statusFallback,
          loading: false,
          error: trackers.length === 0
            ? "このプロジェクトにはトラッカーが設定されていません。"
            : undefined,
        },
      });
    } catch (err) {
      const msg = (err as Error).message;
      store.update({
        editOptions: {
          ticketId,
          projectId,
          trackers: [],
          priorities: globalOptions.priorities,
          statuses: globalOptions.statuses,
          statusFallback: true,
          loading: false,
          error: `プロジェクトのトラッカー取得に失敗しました: ${msg}`,
        },
      });
    }
  }

  async updateTicketMetadata(
    requestId: string,
    ticketId: number,
    patch: TicketMetadataPatch,
  ): Promise<void> {
    const validationError = this.validateMetadataPatchAgainstOptions(patch, ticketId);
    if (validationError) {
      this.deps.context.notifyError(requestId, validationError);
      return;
    }

    const tickets = this.deps.getTickets();
    const ticket = tickets.find((candidate) => candidate.id === ticketId);
    if (!ticket) {
      this.deps.context.notifyError(requestId, "対象チケットが見つかりません。");
      return;
    }

    if (patch.tracker !== undefined && ticket.projectId) {
      const trackerError = await this.validateTrackerForProject(patch.tracker, ticket.projectId, ticket.id);
      if (trackerError) {
        this.deps.context.notifyError(requestId, trackerError);
        return;
      }
    }

    ensureTicketDraft(
      ticket.id,
      ticket.subject,
      ticket.description ?? "",
      {
        tracker: ticket.trackerName ?? "",
        priority: ticket.priorityName ?? "",
        status: ticket.statusName ?? "",
        due_date: ticket.dueDate ?? "",
        start_date: ticket.startDate ?? "",
      },
      ticket.updatedAt,
    );

    const updated = await this.updateRegisteredTicketEditor(ticket, patch)
      || this.updateQueuedTicket(ticket, patch);
    if (!updated) {
      await this.deps.openEditor(ticketId);
      if (!await this.updateRegisteredTicketEditor(ticket, patch)) {
        this.deps.context.notifyError(requestId, "更新対象のチケットエディタを特定できません。");
        return;
      }
    }

    this.applyPatchToLocalTicket(ticket, patch);
    this.deps.refreshUnsynced();
    this.deps.pushTickets();
    this.deps.context.store.update({ selectedTicket: buildTicketDetail(ticket, tickets) });
    this.deps.context.notifySuccess(requestId, "チケット情報を更新しました。同期は既存の同期コマンドで実行されます。");
  }

  private validateMetadataPatchAgainstOptions(patch: TicketMetadataPatch, ticketId?: number): string | undefined {
    if (!this.deps.isMetadataOptionsLoaded()) {
      return "メタデータ選択肢が未取得のため更新できません。";
    }
    const state = this.deps.context.store.getState();
    const editOptions = state.editOptions?.ticketId === ticketId ? state.editOptions : undefined;
    const priorityOptions = editOptions ? editOptions.priorities : state.metadataOptions.priorities;
    const statusOptions = editOptions ? editOptions.statuses : state.metadataOptions.statuses;
    if (patch.priority !== undefined && !priorityOptions.some((item) => item.name === patch.priority)) {
      return `未知の優先度です: ${patch.priority}`;
    }
    if (patch.status !== undefined && !statusOptions.some((item) => item.name === patch.status)) {
      return `未知のステータスです: ${patch.status}`;
    }
    return undefined;
  }

  private async validateTrackerForProject(trackerName: string, projectId: number, ticketId?: number): Promise<string | undefined> {
    try {
      const state = this.deps.context.store.getState();
      const stateEditOpts = state.editOptions;
      const editOptionsMatch = stateEditOpts !== undefined
        && stateEditOpts.ticketId === ticketId
        && stateEditOpts.projectId === projectId;
      const editOptions = editOptionsMatch ? stateEditOpts : undefined;
      let trackers = editOptions ? editOptions.trackers : this.projectTrackerCache.get(projectId);
      if (!trackers) {
        trackers = await getProjectTrackers(projectId);
        this.projectTrackerCache.set(projectId, trackers);
      }
      if (!trackers.some((t) => t.name === trackerName)) {
        return `このプロジェクトでは使用できないトラッカーです: ${trackerName}`;
      }
      return undefined;
    } catch {
      return "このプロジェクトのトラッカー選択肢を取得できないため更新できません。";
    }
  }

  private patchEditorContent(content: TicketEditorContent, patch: TicketMetadataPatch): TicketEditorContent {
    return {
      ...content,
      metadata: {
        ...content.metadata,
        ...(patch.tracker !== undefined ? { tracker: patch.tracker } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.due_date !== undefined ? { due_date: patch.due_date } : {}),
        ...(patch.start_date !== undefined ? { start_date: patch.start_date } : {}),
      },
    };
  }

  private applyPatchToLocalTicket(ticket: Ticket, patch: TicketMetadataPatch): void {
    if (patch.tracker !== undefined) {
      ticket.trackerName = patch.tracker;
      const projectTrackers = ticket.projectId ? this.projectTrackerCache.get(ticket.projectId) : undefined;
      ticket.trackerId = (projectTrackers ?? this.deps.context.store.getState().metadataOptions.trackers)
        .find((item) => item.name === patch.tracker)?.id;
    }
    if (patch.priority !== undefined) {
      ticket.priorityName = patch.priority;
      ticket.priorityId = this.deps.context.store.getState().metadataOptions.priorities
        .find((item) => item.name === patch.priority)?.id;
    }
    if (patch.status !== undefined) {
      ticket.statusName = patch.status;
      ticket.statusId = this.deps.context.store.getState().metadataOptions.statuses
        .find((item) => item.name === patch.status)?.id;
    }
    if (patch.due_date !== undefined) {
      ticket.dueDate = patch.due_date.length > 0 ? patch.due_date : undefined;
    }
    if (patch.start_date !== undefined) {
      ticket.startDate = patch.start_date.length > 0 ? patch.start_date : undefined;
    }
  }

  private async updateRegisteredTicketEditor(ticket: Ticket, patch: TicketMetadataPatch): Promise<boolean> {
    const record = getTicketEditors(ticket.id).find((candidate) => candidate.contentType === "ticket");
    if (!record) {
      return false;
    }
    const uri = vscode.Uri.parse(record.uri);
    let document = vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === record.uri);
    if (!document) {
      document = await vscode.workspace.openTextDocument(uri);
      registerTicketDocument(ticket.id, document, "ticket", ticket.projectId);
    }
    const editor = vscode.window.visibleTextEditors.find((candidate) => candidate.document.uri.toString() === record.uri);
    const parsed = parseTicketEditorContent(document.getText(), {
      allowMissingMetadata: true,
      fallbackMetadata: {
        tracker: ticket.trackerName ?? "",
        priority: ticket.priorityName ?? "",
        status: ticket.statusName ?? "",
        due_date: ticket.dueDate ?? "",
        start_date: ticket.startDate ?? "",
      },
    });
    const next = this.patchEditorContent(parsed, patch);
    const nextText = buildTicketEditorContent(next);
    parseTicketEditorContent(nextText, {
      allowMissingMetadata: true,
      fallbackMetadata: next.metadata,
    });
    if (editor) {
      await applyEditorContent(editor, nextText);
    } else {
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length),
      );
      edit.replace(document.uri, fullRange, nextText);
      await vscode.workspace.applyEdit(edit);
    }
    setTicketDraftContent(ticket.id, next);
    markDraftStatus(ticket.id, "Dirty");
    addOfflineTicketUpdate(ticket.id, {
      ticketId: ticket.id,
      baseSubject: ticket.subject,
      baseDescription: ticket.description ?? "",
      baseMetadata: {
        tracker: ticket.trackerName ?? "",
        priority: ticket.priorityName ?? "",
        status: ticket.statusName ?? "",
        due_date: ticket.dueDate ?? "",
        start_date: ticket.startDate ?? "",
      },
      lastKnownRemoteUpdatedAt: ticket.updatedAt,
      subject: next.subject,
      description: next.description,
      metadata: next.metadata,
      layout: next.layout,
      metadataBlock: next.metadataBlock,
    });
    return true;
  }

  private updateQueuedTicket(ticket: Ticket, patch: TicketMetadataPatch): boolean {
    const queued = getOfflineSyncQueue().tickets.get(ticket.id);
    if (!queued) {
      return false;
    }
    const nextMetadata = {
      ...queued.metadata,
      ...(patch.tracker !== undefined ? { tracker: patch.tracker } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.due_date !== undefined ? { due_date: patch.due_date } : {}),
      ...(patch.start_date !== undefined ? { start_date: patch.start_date } : {}),
    };
    const nextContent: TicketEditorContent = {
      subject: queued.subject,
      description: queued.description,
      metadata: nextMetadata,
      layout: queued.layout,
      metadataBlock: queued.metadataBlock,
    };
    parseTicketEditorContent(buildTicketEditorContent(nextContent), {
      allowMissingMetadata: true,
      fallbackMetadata: nextMetadata,
    });
    setTicketDraftContent(ticket.id, nextContent);
    markDraftStatus(ticket.id, "Dirty");
    addOfflineTicketUpdate(ticket.id, {
      ...queued,
      metadata: nextMetadata,
    });
    return true;
  }
}
