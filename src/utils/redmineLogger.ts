import * as vscode from "vscode";
import { RedmineErrorType } from "./redmineErrors";

export interface LogEntry {
  project_id?: number;
  issue_id?: number;
  draft_id?: string;
  operation_type: string;
  request_time: string;
  response_status?: number;
  error_type?: RedmineErrorType;
  retry_count?: number;
  message?: string;
}

let outputChannel: vscode.OutputChannel | undefined;

const getChannel = (): vscode.OutputChannel => {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("Redmine Client");
  }
  return outputChannel;
};

export const logOperation = (entry: LogEntry): void => {
  const parts: string[] = [
    `[${entry.request_time}]`,
    `[${entry.operation_type}]`,
  ];
  if (entry.issue_id !== undefined) { parts.push(`issue=${entry.issue_id}`); }
  if (entry.project_id !== undefined) { parts.push(`project=${entry.project_id}`); }
  if (entry.draft_id !== undefined) { parts.push(`draft=${entry.draft_id}`); }
  if (entry.response_status !== undefined) { parts.push(`status=${entry.response_status}`); }
  if (entry.error_type !== undefined) { parts.push(`error=${entry.error_type}`); }
  if (entry.retry_count !== undefined) { parts.push(`retry=${entry.retry_count}`); }
  if (entry.message) { parts.push(entry.message); }
  getChannel().appendLine(parts.join(" "));
};
