import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { syncTicketDraft } from "../views/ticketSaveSync";
import { initializeTicketDraft } from "../views/ticketDraftStore";
import { buildTicketEditorContent } from "../views/ticketEditorContent";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";

const createTempImage = (): { dir: string; documentUri: vscode.Uri } => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "todoex-mdimg-"));
  const filePath = path.join(dir, "image.png");
  fs.writeFileSync(filePath, Buffer.from([1, 2, 3]));
  return { dir, documentUri: vscode.Uri.file(path.join(dir, "ticket.md")) };
};

suite("Ticket attachment permission gate", () => {
  test("skips uploads when permission denied", async () => {
    const temp = createTempImage();
    initializeTicketDraft(2, "Title", "Body", buildIssueMetadataFixture(), "t1");

    let updateFields: Record<string, unknown> | undefined;
    const result = await syncTicketDraft({
      ticketId: 2,
      content: buildTicketEditorContent({
        subject: "Title",
        description: "![img](./image.png)",
        metadata: buildIssueMetadataFixture(),
      }),
      documentUri: temp.documentUri,
      deps: {
        getIssueDetail: async () => ({
          ticket: { id: 2, subject: "Title", projectId: 1, updatedAt: "t1" },
          comments: [],
        }),
        updateIssue: async ({ fields }) => {
          updateFields = fields as Record<string, unknown>;
        },
        createIssue: async () => {
          throw new Error("should not create child");
        },
        deleteIssue: async () => undefined,
        listIssueStatuses: async () => [],
        listTrackers: async () => [],
        listIssuePriorities: async () => [],
        uploadFile: async () => {
          throw new Error("Request failed (403): Forbidden");
        },
      },
    });

    assert.strictEqual(result.status, "failed");
    assert.strictEqual(result.uploadSummary?.permissionDenied, true);
    assert.strictEqual(updateFields, undefined);
  });
});
