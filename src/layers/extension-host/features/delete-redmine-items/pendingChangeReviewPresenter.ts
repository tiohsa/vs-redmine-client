import * as vscode from "vscode";
import type { PendingChangeReviewInput } from "./deletionService";

interface ReviewChoice extends vscode.QuickPickItem {
  action: "information" | "open" | "unsynced" | "delete";
  open?: () => Promise<void>;
}

interface ReviewPresenterDependencies {
  pick: (choices: readonly ReviewChoice[], options: vscode.QuickPickOptions) => PromiseLike<ReviewChoice | undefined>;
  showOpenError: () => PromiseLike<unknown>;
}

const defaultDependencies: ReviewPresenterDependencies = {
  pick: (choices, options) => vscode.window.showQuickPick(choices, options),
  showOpenError: () => vscode.window.showErrorMessage(vscode.l10n.t("The pending change could not be opened.")),
};

export const confirmPendingChangeReview = async (
  input: PendingChangeReviewInput,
  dependencies: ReviewPresenterDependencies = defaultDependencies,
): Promise<boolean> => {
  const choices: ReviewChoice[] = [
    { label: vscode.l10n.t("Deletion impact"), detail: input.detail, action: "information" },
    ...input.items.map((item): ReviewChoice => ({
      label: item.open ? vscode.l10n.t("Open: {0}", item.label) : item.label,
      detail: item.detail,
      action: item.open ? "open" : "information",
      open: item.open,
    })),
    ...input.unreadableReferences.map((reference): ReviewChoice => ({
      label: vscode.l10n.t("Unreadable reference: {0}", reference),
      action: "information",
    })),
    ...(input.openUnsynced ? [{ label: vscode.l10n.t("Open Unsynced"), action: "unsynced" as const }] : []),
  ];
  if (input.blocked || input.items.some(item => !item.open)) {
    choices.push({ label: vscode.l10n.t("Deletion is unavailable while affected pending changes cannot be verified or remain unresolved."), action: "information" });
  } else {
    choices.push({ label: vscode.l10n.t("Delete"), action: "delete" });
  }

  while (true) {
    const choice = await dependencies.pick(choices, {
      title: input.title,
      placeHolder: vscode.l10n.t("Review the impact and pending changes before deleting."),
      ignoreFocusOut: true,
      matchOnDetail: true,
    });
    if (!choice) { return false; }
    if (choice.action === "delete") { return true; }
    if (choice.action === "open" || choice.action === "unsynced") {
      try {
        await (choice.action === "open" ? choice.open : input.openUnsynced)?.();
      } catch {
        void dependencies.showOpenError();
      }
      return false;
    }
  }
};
