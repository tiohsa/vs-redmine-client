import * as vscode from "vscode";
import { configureOfflineSyncMode } from "../commands/offlineSyncMode";
import { configureEditorDefaultField, resetEditorDefaults } from "../views/editorDefaultCommands";
import { EDITOR_DEFAULT_COMMANDS, TICKET_SETTINGS_COMMANDS } from "./commandIds";
import type { CommandDeps } from "./commandRegistry";

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
