import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { TicketSyncService } from "../app/ticketSync/ticketSyncService";
import type { IssueUpdateInput } from "../redmine/issues";
import { buildTicketEditorContent } from "../views/ticketEditorContent";
import { getOfflineSyncQueue, initializeOfflineSyncStore } from "../views/offlineSyncStore";
import { clearTicketDrafts } from "../views/ticketDraftStore";
import { createTestMemento } from "./helpers/vscodeMemento";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";

suite("新規登録後の画像追加・再同期", () => {
  for (const keepOriginal of [false, true]) {
    for (const queued of [false, true]) {
      test(`既存画像を再送せず追加画像だけ同期する (元画像=${keepOriginal}, キュー再開=${queued})`, async () => {
        const scope = `https://image-resync.example.org/${keepOriginal}/${queued}`;
        const memento = createTestMemento();
        initializeOfflineSyncStore(memento, scope);
        clearTicketDrafts(scope);
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ticket-image-resync-"));
        const uri = vscode.Uri.file(path.join(directory, "ticket.md"));
        const metadata = buildIssueMetadataFixture();
        fs.writeFileSync(path.join(directory, "first.png"), "first");
        fs.writeFileSync(path.join(directory, "second.png"), "second");
        fs.writeFileSync(uri.fsPath, buildTicketEditorContent({
          subject: "画像付きチケット",
          description: "![first](./first.png)",
          metadata,
          controlFields: { mode: "new-ticket", project_id: 12 },
        }));
        const document = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(document);
        let remoteDescription = "";
        let createCalls = 0;
        const uploads: string[] = [];
        const updates: IssueUpdateInput[] = [];
        const uploadFile = async (filePath: string) => {
          const bytes = fs.readFileSync(filePath, "utf8");
          uploads.push(bytes);
          return { token: `${bytes}-token`, filename: `${bytes}.png`, contentType: "image/png" };
        };
        const getIssueDetail = async () => ({
          ticket: {
            id: 920, projectId: 12, subject: "画像付きチケット", description: remoteDescription,
            trackerName: metadata.tracker, priorityName: metadata.priority, statusName: metadata.status,
            updatedAt: `t${updates.length + 1}`,
          },
          comments: [],
        });
        const service = new TicketSyncService({
          create: {
            listIssueStatuses: async () => [{ id: 1, name: metadata.status }],
            listTrackers: async () => [{ id: 2, name: metadata.tracker }],
            listIssuePriorities: async () => [{ id: 3, name: metadata.priority }],
            getProjectTrackers: async () => [{ id: 2, name: metadata.tracker }],
            searchUsers: async () => [],
            uploadFile,
            getIssueDetail,
            createIssue: async (input) => {
              createCalls++;
              remoteDescription = input.description;
              return 920;
            },
          },
          update: {
            uploadFile,
            getIssueDetail,
            updateIssue: async (input) => {
              updates.push(input);
              remoteDescription = input.fields.description ?? remoteDescription;
            },
          },
        });
        try {
          const created = await service.syncEditor({
            context: { connectionScope: scope }, editor, ticketId: -1,
            newTicket: true, manual: false, projectId: 12,
          });
          assert.strictEqual(created.kind, "completed", JSON.stringify(created));
          assert.ok(document.getText().includes("![first](first.png)"));
          if (!keepOriginal) {
            fs.unlinkSync(path.join(directory, "first.png"));
          }

          // 同じエディタで画像追加、その後は本文だけ編集する。
          for (const addition of ["\n![second](./second.png)", "\n本文の追記"]) {
            assert.ok(await editor.edit((builder) => builder.insert(
              document.positionAt(document.getText().length), addition,
            )));
            let result = await service.syncEditor({
              context: { connectionScope: scope }, editor, ticketId: 920,
              newTicket: false, manual: queued,
            });
            if (queued) {
              assert.strictEqual(result.kind, "queued", JSON.stringify(result));
              initializeOfflineSyncStore(memento, scope);
              result = await service.syncQueueItem({ kind: "ticket", ticketId: 920 }, { connectionScope: scope });
            }
            assert.strictEqual(result.kind, "completed", JSON.stringify(result));
            if (updates.length === 1) {
              assert.strictEqual(fs.readFileSync(uri.fsPath, "utf8"), document.getText());
            }
          }
          assert.strictEqual(createCalls, 1);
          assert.deepStrictEqual(uploads, ["first", "second"]);
          assert.strictEqual(updates.length, 2);
          assert.deepStrictEqual(updates[0].fields.uploads, [
            { token: "second-token", filename: "second.png", content_type: "image/png" },
          ]);
          assert.strictEqual(updates[1].fields.uploads, undefined);
          assert.strictEqual(remoteDescription, "![first](first.png)\n![second](second.png)\n本文の追記");
          assert.ok(document.getText().includes(remoteDescription));
          assert.strictEqual(getOfflineSyncQueue(scope).newTickets.length, 0);
          assert.strictEqual(getOfflineSyncQueue(scope).tickets.size, 0);

          if (keepOriginal) {
            // 同名でも明示的にローカルパスを追加した場合はアップロードする。
            await editor.edit((builder) => builder.insert(
              document.positionAt(document.getText().length), "\n![replacement](./first.png)",
            ));
            const replaced = await service.syncEditor({
              context: { connectionScope: scope }, editor, ticketId: 920, newTicket: false, manual: false,
            });
            assert.strictEqual(replaced.kind, "completed", JSON.stringify(replaced));
            assert.deepStrictEqual(uploads, ["first", "second", "first"]);
            assert.deepStrictEqual(updates[2].fields.uploads, [
              { token: "first-token", filename: "first.png", content_type: "image/png" },
            ]);
          }

          // 未同期のファイル名参照は欠落を見逃さず、リモートを更新しない。
          await editor.edit((builder) => builder.insert(
            document.positionAt(document.getText().length), "\n![missing](missing.png)",
          ));
          const failed = await service.syncEditor({
            context: { connectionScope: scope }, editor, ticketId: 920, newTicket: false, manual: false,
          });
          assert.strictEqual(failed.kind, "failed_before_commit", JSON.stringify(failed));
          assert.strictEqual(updates.length, keepOriginal ? 3 : 2);
          assert.strictEqual(uploads.length, keepOriginal ? 3 : 2);
          assert.ok(document.getText().includes("![missing](missing.png)"));
        } finally {
          await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
          clearTicketDrafts(scope);
          fs.rmSync(directory, { recursive: true, force: true });
        }
      });
    }
  }
});
