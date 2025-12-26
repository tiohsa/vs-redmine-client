import * as vscode from "vscode";
import { Ticket } from "../redmine/types";

export const buildTicketPreviewContent = (ticket: Pick<Ticket, "subject" | "description">): string => {
  const description = ticket.description ?? "";
  return `# ${ticket.subject}\n\n${description}`.trim();
};

export const showTicketPreview = async (ticket: Ticket): Promise<void> => {
  const content = buildTicketPreviewContent(ticket);
  const document = await vscode.workspace.openTextDocument({
    content,
    language: "markdown",
  });
  await vscode.window.showTextDocument(document, { preview: true });
};
