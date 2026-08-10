import * as assert from "assert";
import { rebaseTicketEditorContent } from "../app/ticketSync/ticketIntentRebase";
import type { TicketEditorContent } from "../views/ticketEditorContent";

const base = (): TicketEditorContent => ({
  subject: "Base subject",
  description: "Base body",
  metadata: {
    tracker: "Task",
    priority: "Normal",
    status: "In Progress",
    due_date: "",
  },
});

suite("ticket intent canonical rebase", () => {
  test("未変更fieldはremote canonicalを採用し後続local editは保持する", () => {
    const active = base();
    const canonical: TicketEditorContent = {
      ...active,
      subject: "Canonical subject",
      metadata: { ...active.metadata, status: "Closed" },
    };
    const latest: TicketEditorContent = {
      ...active,
      description: "Edited while sync was pending",
    };

    const result = rebaseTicketEditorContent(active, canonical, latest);

    assert.strictEqual(result.subject, "Canonical subject");
    assert.strictEqual(result.metadata.status, "Closed");
    assert.strictEqual(result.description, "Edited while sync was pending");
  });

  test("remoteとlocalが同じfieldを変更した場合もlocal intentを破壊しない", () => {
    const active = base();
    const canonical = { ...active, subject: "Server workflow subject" };
    const latest = { ...active, subject: "User subject" };

    const result = rebaseTicketEditorContent(active, canonical, latest);

    assert.strictEqual(result.subject, "User subject");
  });
});
