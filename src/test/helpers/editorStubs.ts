import * as vscode from "vscode";

export const createDocumentStub = (
  uri: vscode.Uri,
  text: string,
): vscode.TextDocument =>
  ({
    uri,
    getText: () => text,
  }) as vscode.TextDocument;

export const createEditorStub = (uri: vscode.Uri, text: string): vscode.TextEditor => {
  const document = createDocumentStub(uri, text);
  return {
    document,
  } as vscode.TextEditor;
};
