import * as vscode from "vscode";
import { buildTicketEditorContent } from "../../views/ticketEditorContent";
import { IssueMetadata } from "../../views/ticketMetadataTypes";
import { buildIssueMetadataFixture } from "./ticketMetadataFixtures";

type MutableDocument = vscode.TextDocument & { setText: (text: string) => void };

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

export const createMutableDocumentStub = (
  uri: vscode.Uri,
  text: string,
): MutableDocument => {
  let content = text;
  return {
    uri,
    getText: () => content,
    setText: (next: string) => {
      content = next;
    },
  } as MutableDocument;
};

export const createMutableEditorStub = (
  uri: vscode.Uri,
  text: string,
): vscode.TextEditor & { document: MutableDocument } => {
  const document = createMutableDocumentStub(uri, text);
  return {
    document,
  } as vscode.TextEditor & { document: MutableDocument };
};

export const createTicketContentFixture = (
  subject: string,
  description: string,
  overrides: Partial<IssueMetadata> = {},
): string =>
  buildTicketEditorContent({
    subject,
    description,
    metadata: buildIssueMetadataFixture(overrides),
  });
