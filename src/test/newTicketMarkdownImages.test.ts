import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { TicketSyncService } from "../app/ticketSync/ticketSyncService";
import type { IssueCreateInput } from "../redmine/issues";
import { getPrimaryEffectForRevision } from "../app/syncEffects";
import { buildTicketEditorContent } from "../views/ticketEditorContent";
import { initializeOfflineSyncStore, getOfflineSyncQueue } from "../views/offlineSyncStore";
import { createTestMemento } from "./helpers/vscodeMemento";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";

suite("新規チケットの Markdown 画像アップロード", () => {
  for (const failure of ["missing", "outside", "timeout", "forbidden"] as const) {
    test(`画像の ${failure} で CREATE せず、再起動後も不確定・権限エラーの upload を再送しない`, async () => {
      const scope = `https://new-ticket-images.example.org/${failure}`;
      const memento = createTestMemento();
      initializeOfflineSyncStore(memento, scope);
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "new-ticket-images-failure-"));
      const metadata = buildIssueMetadataFixture();
      fs.writeFileSync(path.join(directory, "first.png"), "first");
      fs.writeFileSync(path.join(directory, "second.png"), "second");
      const description = failure === "missing" ? "![image](missing.png)"
        : failure === "outside" ? "![image](../outside.png)"
        : "![first](first.png)\n![second](second.png)";
      const documentUri = vscode.Uri.file(path.join(directory, "new.md")).toString();
      let uploadCalls = 0;
      let createCalls = 0;
      const service = new TicketSyncService({ create: {
        listIssueStatuses: async () => [{ id: 1, name: metadata.status }],
        listTrackers: async () => [{ id: 2, name: metadata.tracker }],
        listIssuePriorities: async () => [{ id: 3, name: metadata.priority }],
        getProjectTrackers: async () => [{ id: 2, name: metadata.tracker }],
        searchUsers: async () => [],
        uploadFile: async () => {
          uploadCalls++;
          if (uploadCalls === 1) {
            return { token: "first-token", filename: "first.png", contentType: "image/png" };
          }
          throw new Error(failure === "timeout" ? "socket timeout" : "Request failed (403): Forbidden");
        },
        createIssue: async () => { createCalls++; return 911; },
      } });
      try {
        await service.syncNewTicket({ context: { connectionScope: scope }, operation: {
          content: buildTicketEditorContent({ subject: "Image ticket", description, metadata }),
          projectId: 12, documentUri,
        } });
        const pending = getOfflineSyncQueue(scope).newTickets[0];
        assert.ok(pending);
        assert.strictEqual(createCalls, 0);
        assert.strictEqual(uploadCalls, failure === "timeout" || failure === "forbidden" ? 2 : 0);
        if (failure === "timeout" || failure === "forbidden") {
          assert.ok(pending.effects?.some((effect) => effect.token === "first-token" && effect.state === "committed"));
          const second = pending.effects?.find((effect) => effect.target.filePath === path.join(directory, "second.png"));
          assert.strictEqual(second?.state, failure === "timeout" ? "commit_unknown" : "failed");
        }
        initializeOfflineSyncStore(memento, scope);
        await service.syncQueueItem({ kind: "newTicket", documentUri }, { connectionScope: scope });
        assert.strictEqual(createCalls, 0);
        assert.strictEqual(uploadCalls, failure === "timeout" || failure === "forbidden" ? 2 : 0);
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });
  }

  for (const queued of [false, true]) {
    test(`${queued ? "保存済みキュー" : "エディタ"}から画像を添付し、再起動後は再送せず本文を反映する`, async () => {
      const scope = `https://new-ticket-images.example.org/${queued}`;
      const memento = createTestMemento();
      initializeOfflineSyncStore(memento, scope);
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "new-ticket-images-"));
      const uri = vscode.Uri.file(path.join(directory, "new-ticket.md"));
      fs.writeFileSync(path.join(directory, "screen.png"), "image-bytes");
      const metadata = buildIssueMetadataFixture();
      const content = buildTicketEditorContent({
        subject: "Image ticket",
        description: "![a](./screen.png)\n![b](screen.png)",
        metadata,
        controlFields: { mode: "new-ticket", project_id: 12 },
      }).replace(/\n/g, "\r\n");
      fs.writeFileSync(uri.fsPath, content);
      const document = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(document);
      let uploadCalls = 0;
      let createCalls = 0;
      let readBackAvailable = false;
      let request: IssueCreateInput | undefined;
      const service = new TicketSyncService({
        create: {
          listIssueStatuses: async () => [{ id: 1, name: metadata.status }],
          listTrackers: async () => [{ id: 2, name: metadata.tracker }],
          listIssuePriorities: async () => [{ id: 3, name: metadata.priority }],
          getProjectTrackers: async () => [{ id: 2, name: metadata.tracker }],
          searchUsers: async () => [],
          uploadFile: async (filePath) => {
            uploadCalls++;
            assert.notStrictEqual(filePath, path.join(directory, "screen.png"));
            assert.strictEqual(fs.readFileSync(filePath, "utf8"), "image-bytes");
            return { token: "image-token", filename: "uploaded.png", contentType: "image/png" };
          },
          createIssue: async (input) => { createCalls++; request = input; return 910; },
          getIssueDetail: async () => {
            if (!readBackAvailable) { throw new Error("read-back unavailable"); }
            return {
              ticket: { id: 910, projectId: 12, subject: "Image ticket", description: request?.description,
                trackerName: metadata.tracker, statusName: metadata.status, priorityName: metadata.priority },
              comments: [],
            };
          },
        },
      });
      try {
        const first = queued
          ? await service.syncNewTicket({ context: { connectionScope: scope }, operation: {
            content, projectId: 12, documentUri: uri.toString(),
          } })
          : await service.syncEditor({ context: { connectionScope: scope }, editor,
            ticketId: -1, newTicket: true, manual: false, projectId: 12 });
        assert.strictEqual(uploadCalls, 1, "同じ画像の別表記も1回だけアップロードする");
        assert.strictEqual(createCalls, 1);
        assert.strictEqual(request?.description, "![a](uploaded.png)\n![b](uploaded.png)");
        assert.deepStrictEqual(request?.uploads, [
          { token: "image-token", filename: "uploaded.png", content_type: "image/png" },
        ]);
        assert.strictEqual(first.kind, "remote_committed");
        const pending = getOfflineSyncQueue(scope).newTickets[0];
        const image = pending.effects?.find((effect) => effect.kind === "image_upload");
        assert.strictEqual(image?.state, "committed");
        assert.strictEqual(image?.requestSnapshot?.kind, "upload");
        if (image?.requestSnapshot?.kind === "upload") {
          assert.ok(image.requestSnapshot.contentHash);
          assert.strictEqual(image.requestSnapshot.contentSize, 11);
          assert.ok(image.requestSnapshot.spoolFilePath);
        }
        const primary = getPrimaryEffectForRevision(pending);
        assert.deepStrictEqual(primary?.requestSnapshot, { kind: "ticket_create", request });
        assert.strictEqual(document.getText(), content, "元の本文はローカル反映まで保持する");
        initializeOfflineSyncStore(memento, scope);
        fs.unlinkSync(path.join(directory, "screen.png"));
        readBackAvailable = true;
        const resumed = await service.syncQueueItem({ kind: "newTicket", documentUri: uri.toString() }, { connectionScope: scope });
        assert.strictEqual(resumed.kind, "completed", JSON.stringify(resumed));
        assert.strictEqual(uploadCalls, 1);
        assert.strictEqual(createCalls, 1);
        assert.ok(document.getText().includes("![a](uploaded.png)\r\n![b](uploaded.png)"));
        assert.strictEqual(getOfflineSyncQueue(scope).newTickets.length, 0);
      } finally {
        await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });
  }
});
