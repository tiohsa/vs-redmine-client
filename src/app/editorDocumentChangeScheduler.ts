import * as vscode from "vscode";
import { scheduleTask } from "../packages/framework-core";

const TEXT_CHANGE_DEBOUNCE_MS = 300;

interface PendingDocumentChange {
  cancel: () => void;
  document: vscode.TextDocument;
}

export interface EditorDocumentChangeScheduler {
  schedule(document: vscode.TextDocument): void;
  clear(uriKey: string): void;
  flush(uriKey: string): void;
  flushAll(): void;
  dispose(): void;
}

export const createPendingDocumentChangeScheduler = (
  onChange: (document: vscode.TextDocument) => void,
): EditorDocumentChangeScheduler => {
  const pendingChanges = new Map<string, PendingDocumentChange>();

  const clear = (uriKey: string): void => {
    const pending = pendingChanges.get(uriKey);
    if (!pending) {
      return;
    }
    pending.cancel();
    pendingChanges.delete(uriKey);
  };

  const flush = (uriKey: string): void => {
    const pending = pendingChanges.get(uriKey);
    if (pending) {
      clear(uriKey);
      onChange(pending.document);
    }
  };

  return {
    schedule(document): void {
      const uriKey = document.uri.toString();
      clear(uriKey);
      const pending: PendingDocumentChange = { document, cancel: () => undefined };
      pending.cancel = scheduleTask(() => {
        pendingChanges.delete(uriKey);
        onChange(document);
      }, TEXT_CHANGE_DEBOUNCE_MS);
      pendingChanges.set(uriKey, pending);
    },
    clear,
    flush,
    flushAll(): void {
      for (const uriKey of Array.from(pendingChanges.keys())) {
        flush(uriKey);
      }
    },
    dispose(): void {
      for (const pending of pendingChanges.values()) {
        pending.cancel();
      }
      pendingChanges.clear();
    },
  };
};
