import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { buildNewTicketDraftUri } from "../commands/createTicketFromList";

suite("New ticket draft uri", () => {
  test("builds untitled uri in workspace", () => {
    const uri = buildNewTicketDraftUri("/workspace", () => false);
    const expected = vscode.Uri.file(
      path.join("/workspace", "redmine-client-new-ticket.md"),
    ).with({ scheme: "untitled" });

    assert.strictEqual(uri.toString(), expected.toString());
  });

  test("adds suffix when filename already exists", () => {
    const uri = buildNewTicketDraftUri(
      "/workspace",
      (candidate) => candidate === path.join("/workspace", "redmine-client-new-ticket.md"),
    );
    const expected = vscode.Uri.file(
      path.join("/workspace", "redmine-client-new-ticket-1.md"),
    ).with({ scheme: "untitled" });

    assert.strictEqual(uri.toString(), expected.toString());
  });
});
