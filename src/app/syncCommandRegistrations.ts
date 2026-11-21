import * as vscode from "vscode";
import { runOfflineSync } from "../commands/offlineSync";
import { syncUnsyncedFile } from "../commands/syncUnsyncedFile";
import { showSuccess } from "../utils/notifications";
import { getAllEditorRecords, isTicketEditor } from "../views/ticketEditorRegistry";
import type { SyncStatus } from "./syncController";
import { validateDashboardUnsyncedKey } from "../dashboard/dashboardMessageValidation";
import type { CommandDeps } from "./commandRegistry";

const openEditorForUri = async (uriStr: string): Promise<vscode.TextEditor> => {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uriStr));
  return (
    vscode.window.visibleTextEditors.find((e: vscode.TextEditor) => e.document === document) ??
    (await vscode.window.showTextDocument(document, { preview: false }))
  );
};

export const registerSyncCommands = (
  context: vscode.ExtensionContext,
  deps: Pick<CommandDeps, "sync" | "ticketsPresentation" | "commentsPresentation" | "unsyncedPresentation" | "syncEngine">,
): void => {
  const { sync, ticketsPresentation, commentsPresentation, unsyncedPresentation, syncEngine } = deps;

  context.subscriptions.push(
    vscode.commands.registerCommand("redmine-client.runOfflineSync", async () => {
      const result = await runOfflineSync(deps.syncEngine
        ? { createSyncEngine: () => deps.syncEngine! }
        : undefined);
      unsyncedPresentation.refresh();
      if (
        result.createdTicketIds &&
        result.createdTicketIds.length > 0 &&
        ticketsPresentation.revealCreatedTickets
      ) {
        await ticketsPresentation.revealCreatedTickets(result.createdTicketIds).catch(() => undefined);
      } else if (
        result.createdComments &&
        result.createdComments.length > 0 &&
        commentsPresentation.revealCreatedComment
      ) {
        ticketsPresentation.refresh();
        const lastComment = result.createdComments[result.createdComments.length - 1];
        await commentsPresentation
          .revealCreatedComment(lastComment.ticketId, lastComment.commentId)
          .catch(() => undefined);
      } else {
        ticketsPresentation.refresh();
      }
    }),
    vscode.commands.registerCommand("redmine-client.syncUnsyncedFile", async (item: unknown) => {
      const withKey = item as { syncKey?: unknown } | undefined;
      if (!validateDashboardUnsyncedKey(withKey?.syncKey)) {
        vscode.window.showErrorMessage(vscode.l10n.t("Select sync target from the Dashboard unsynced list."));
        return;
      }
      let ticketCreated = false;
      let createdTicketId: number | undefined;
      const result = await syncUnsyncedFile(
        { syncKey: withKey.syncKey },
        {
          onTicketCreated: (ticketId) => {
            ticketCreated = true;
            createdTicketId = ticketId;
          },
          createSyncEngine: deps.syncEngine ? () => deps.syncEngine! : undefined,
        },
      );
      unsyncedPresentation.refresh();
      if (
        createdTicketId !== undefined &&
        createdTicketId > 0 &&
        ticketsPresentation.revealCreatedTickets
      ) {
        await ticketsPresentation.revealCreatedTickets([createdTicketId]).catch(() => undefined);
      } else if (
        withKey.syncKey.kind === "comment" &&
        withKey.syncKey.commentId === undefined &&
        result?.kind === "comment" &&
        result.status === "success" &&
        typeof result.id === "number" &&
        result.id > 0 &&
        commentsPresentation.revealCreatedComment
      ) {
        await commentsPresentation
          .revealCreatedComment(withKey.syncKey.ticketId, result.id)
          .catch(() => undefined);
      } else if (ticketCreated) {
        ticketsPresentation.refresh();
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("redmine-client.syncToRedmine", async () => {
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor && isTicketEditor(activeEditor)) {
        return sync.syncEditorAndNotify(activeEditor);
      }

      const fallbackRecord = getAllEditorRecords()
        .filter(
          (record) =>
            record.contentType === "ticket" ||
            record.contentType === "comment" ||
            record.contentType === "commentDraft",
        )
        .sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];
      if (!fallbackRecord) {
        return undefined;
      }

      const editor = await openEditorForUri(fallbackRecord.uri);
      return sync.syncEditorAndNotify(editor);
    }),
    vscode.commands.registerCommand(
      "redmine-client.syncOpenEditor",
      async (item: { uri?: string } & { record?: { uri?: string } }) => {
        const uriStr = item?.uri ?? item?.record?.uri;
        if (!uriStr) {
          return undefined;
        }
        const editor = await openEditorForUri(uriStr);
        return sync.syncEditorAndNotify(editor);
      },
    ),
    vscode.commands.registerCommand("redmine-client.syncAllOpenEditors", async () => {
      const records = getAllEditorRecords().filter(
        (r) =>
          r.contentType === "ticket" ||
          r.contentType === "comment" ||
          r.contentType === "commentDraft",
      );
      if (records.length === 0) {
        return;
      }
      const counts: Record<SyncStatus, number> = {
        uploaded: 0,
        merged: 0,
        noChange: 0,
        conflict: 0,
        failed: 0,
      };
      for (const record of records) {
        try {
          const editor = await openEditorForUri(record.uri);
          const status = await sync.syncEditorAndNotify(editor);
          counts[status]++;
        } catch {
          counts.failed++;
        }
      }
      const parts: string[] = [];
      if (counts.uploaded > 0) { parts.push(`Uploaded ${counts.uploaded}`); }
      if (counts.merged > 0) { parts.push(`Merged ${counts.merged}; save to sync`); }
      if (counts.noChange > 0) { parts.push(`No change: ${counts.noChange}`); }
      if (counts.failed > 0) { parts.push(`Failed: ${counts.failed}`); }
      if (counts.conflict > 0) { parts.push(`Conflict: ${counts.conflict}`); }
      showSuccess(parts.join(". ") + ".");
      unsyncedPresentation.refresh();
    }),
  );
};
