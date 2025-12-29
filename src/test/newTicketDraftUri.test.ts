import * as assert from "assert";
import { buildNewTicketDraftUri } from "../commands/createTicketFromList";

suite("New ticket draft uri", () => {
  test("builds untitled uri in workspace", () => {
    const uri = buildNewTicketDraftUri("/workspace", () => false);

    assert.strictEqual(uri.toString(), "untitled:/workspace/redmine-client-new-ticket.md");
  });

  test("adds suffix when filename already exists", () => {
    const uri = buildNewTicketDraftUri(
      "/workspace",
      (candidate) => candidate === "/workspace/redmine-client-new-ticket.md",
    );

    assert.strictEqual(uri.toString(), "untitled:/workspace/redmine-client-new-ticket-1.md");
  });
});
