import * as vscode from "vscode";

import { applyEditorContent } from "./ticketPreview";

export const hasConflictDocumentChanged = (
    document: vscode.TextDocument,
    version: number,
    text: string,
): boolean => document.version !== version || document.getText() !== text;

export const applyConflictEditorContent = async (
    editor: vscode.TextEditor,
    content: string,
    removeQueueEntry: () => Promise<boolean>,
): Promise<boolean> => {
    const previousContent = editor.document.getText();
    await applyEditorContent(editor, content);
    const appliedContent = editor.document.getText();

    if (appliedContent.replace(/\r\n/g, "\n") !== content.replace(/\r\n/g, "\n")) { return false; }
    const appliedVersion = editor.document.version;
    const restore = async (): Promise<void> => {

        if (!hasConflictDocumentChanged(editor.document, appliedVersion, appliedContent)) {
            await applyEditorContent(editor, previousContent);
        }
    };
    let removed: boolean;
    try {
        removed = await removeQueueEntry();
    } catch (error) {
        await restore();
        throw error;
    }
    if (!removed) { await restore(); }
    return removed;
};

