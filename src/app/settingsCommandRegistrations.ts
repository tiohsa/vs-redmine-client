import * as vscode from "vscode";
import { configureOfflineSyncMode } from "../commands/offlineSyncMode";
import { configureEditorDefaultField, resetEditorDefaults } from "../views/editorDefaultCommands";
import { EDITOR_DEFAULT_COMMANDS, TICKET_SETTINGS_COMMANDS } from "./commandIds";
import type { CommandDeps } from "./commandRegistry";
import { registerStubMessage } from "./registerCommandStub";

const getSettingsFilterStubCommands = (): ReadonlyArray<readonly [string, string]> => {
  const filterMsg = vscode.l10n.t("Use the Dashboard Settings tab to configure filters.");
  return [
    [TICKET_SETTINGS_COMMANDS.titleFilter, filterMsg],
    [TICKET_SETTINGS_COMMANDS.priorityFilter, filterMsg],
    [TICKET_SETTINGS_COMMANDS.statusFilter, filterMsg],
    [TICKET_SETTINGS_COMMANDS.trackerFilter, filterMsg],
    [TICKET_SETTINGS_COMMANDS.assigneeFilter, filterMsg],
    [TICKET_SETTINGS_COMMANDS.sort, vscode.l10n.t("Use the Dashboard Settings tab to configure sort order.")],
    [TICKET_SETTINGS_COMMANDS.dueDate, vscode.l10n.t("Use the Dashboard Settings tab to configure due date display.")],
    [TICKET_SETTINGS_COMMANDS.reset, vscode.l10n.t("Use the Dashboard Settings tab to reset settings.")],
  ];
};

const EDITOR_DEFAULT_FIELD_COMMANDS: ReadonlyArray<readonly [string, "subject" | "description" | "tracker" | "priority" | "status" | "due_date"]> = [
  [EDITOR_DEFAULT_COMMANDS.subject, "subject"],
  [EDITOR_DEFAULT_COMMANDS.description, "description"],
  [EDITOR_DEFAULT_COMMANDS.tracker, "tracker"],
  [EDITOR_DEFAULT_COMMANDS.priority, "priority"],
  [EDITOR_DEFAULT_COMMANDS.status, "status"],
  [EDITOR_DEFAULT_COMMANDS.dueDate, "due_date"],
];

export const registerSettingsCommands = (
  context: vscode.ExtensionContext,
  { settingsPresentation }: Pick<CommandDeps, "settingsPresentation">,
): void => {
  context.subscriptions.push(
    ...getSettingsFilterStubCommands().map(([id, message]) => registerStubMessage(id, message)),
    vscode.commands.registerCommand(TICKET_SETTINGS_COMMANDS.offlineSyncMode, async () => {
      await configureOfflineSyncMode();
      settingsPresentation.refresh();
    }),
  );

  context.subscriptions.push(
    ...EDITOR_DEFAULT_FIELD_COMMANDS.map(([id, field]) =>
      vscode.commands.registerCommand(id, async () => {
        await configureEditorDefaultField(field);
        settingsPresentation.refresh();
      }),
    ),
    vscode.commands.registerCommand(EDITOR_DEFAULT_COMMANDS.reset, async () => {
      await resetEditorDefaults();
      settingsPresentation.refresh();
    }),
  );
};
