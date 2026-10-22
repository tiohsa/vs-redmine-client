import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { uploadFileAttachment } from "../../redmine/attachments";
import { liveTest, type LiveFixture } from "./liveFixture";

const pngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pHsAAAAASUVORK5CYII=",
  "base64",
);
const lf = (text: string | undefined): string | undefined => text?.replace(/\r\n/g, "\n");

const writeFile = (live: LiveFixture, relativePath: string, content: Uint8Array | string): string => {
  const filePath = path.join(live.directory, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
};

const uploadedAttachmentNames = async (live: LiveFixture, issueId: number): Promise<string[]> => {
  const response = await live.request<{
    issue: { attachments?: Array<{ filename: string }> };
  }>({
    method: "GET",
    path: `/issues/${issueId}.json`,
    query: { include: "attachments" },
  });
  return (response.issue.attachments ?? []).map((attachment) => attachment.filename);
};

const uploadCount = (live: LiveFixture): number =>
  live.proxy.hits().filter((hit) => hit.method === "POST" && hit.path === "/uploads.json").length;

const assertCompleted = (outcome: { kind: string }): void => {
  assert.strictEqual(outcome.kind, "completed");
};

const withClipboard = async (dataUri: string, operation: () => Promise<void>): Promise<void> => {
  const previous = await vscode.env.clipboard.readText();
  try {
    await vscode.env.clipboard.writeText(dataUri);
    await operation();
  } finally {
    await vscode.env.clipboard.writeText(previous);
  }
};

liveTest("LIVE-N01", "新規ticketの日本語本文と改行・metadataを同期する", async (live) => {
  const subject = `LIVE-N01 日本語 ${Date.now()}`;
  const description = "日本語の説明\n2行目\n\n最後の行";
  const key = await live.queueNewTicket({
    subject,
    description,
    metadata: {
      ...live.metadata,
      start_date: "2026-10-01",
      due_date: "2026-10-30",
      done_ratio: 35,
      estimated_hours: 2.5,
    },
  });

  const outcome = await live.engine().syncOne(key, live.context);
  assertCompleted(outcome);
  if (outcome.kind !== "completed") { return; }
  const remote = await live.readIssue(outcome.ticketId);
  assert.strictEqual(remote.ticket.subject, subject);
  assert.strictEqual(lf(remote.ticket.description), description);
  assert.strictEqual(remote.ticket.startDate, "2026-10-01");
  assert.strictEqual(remote.ticket.dueDate, "2026-10-30");
  assert.strictEqual(remote.ticket.doneRatio, 35);
  assert.strictEqual(remote.ticket.estimatedHours, 2.5);
});

liveTest("LIVE-N02", "新規ticketにfile attachmentを追加する", async (live) => {
  const filePath = writeFile(live, "live-n02.txt", "LIVE-N02 attachment\n日本語 file");
  const key = await live.queueNewTicket({
    subject: `LIVE-N02 ${Date.now()}`,
    attachments: [{ kind: "file", filePath }],
  });

  const outcome = await live.engine().syncOne(key, live.context);
  assertCompleted(outcome);
  if (outcome.kind !== "completed") { return; }
  assert.ok((await uploadedAttachmentNames(live, outcome.ticketId)).includes("live-n02.txt"));
  assert.strictEqual(uploadCount(live), 1);
});

liveTest("LIVE-N03", "新規ticketにclipboard imageを追加する", async (live) => {
  const key = await live.queueNewTicket({
    subject: `LIVE-N03 ${Date.now()}`,
    attachments: [{ kind: "clipboard", filename: "live-n03.png", contentType: "image/png" }],
  });

  await withClipboard(`data:image/png;base64,${pngBytes.toString("base64")}`, async () => {
    const outcome = await live.engine().syncOne(key, live.context);
    assertCompleted(outcome);
    if (outcome.kind !== "completed") { return; }
    assert.ok((await uploadedAttachmentNames(live, outcome.ticketId)).includes("live-n03.png"));
    assert.strictEqual(uploadCount(live), 1);
  });
});

liveTest("LIVE-N04", "新規ticketに事前upload済みtokenを添付する", async (live) => {
  const filePath = writeFile(live, "live-n04-token.txt", "LIVE-N04 token attachment");
  const uploaded = await live.run(() => uploadFileAttachment(filePath));
  const key = await live.queueNewTicket({
    subject: `LIVE-N04 ${Date.now()}`,
    uploadTokens: [{ token: uploaded.token, filename: uploaded.filename, content_type: uploaded.contentType }],
  });

  const outcome = await live.engine().syncOne(key, live.context);
  assertCompleted(outcome);
  if (outcome.kind !== "completed") { return; }
  assert.ok((await uploadedAttachmentNames(live, outcome.ticketId)).includes("live-n04-token.txt"));
  assert.strictEqual(uploadCount(live), 1);
});

liveTest("LIVE-N05", "新規ticket本文の同じMarkdown image参照を一度だけuploadする", async (live) => {
  writeFile(live, "live-n05.png", pngBytes);
  const key = await live.queueNewTicket({
    subject: `LIVE-N05 ${Date.now()}`,
    description: "同じ画像 ![first](./live-n05.png) と ![second](./live-n05.png)",
    baseDir: live.directory,
  });

  const outcome = await live.engine().syncOne(key, live.context);
  assertCompleted(outcome);
  if (outcome.kind !== "completed") { return; }
  const remote = await live.readIssue(outcome.ticketId);
  assert.strictEqual(uploadCount(live), 1);
  assert.ok(remote.ticket.description?.includes("![first](live-n05.png)"));
  assert.ok(remote.ticket.description?.includes("![second](live-n05.png)"));
  assert.ok((await uploadedAttachmentNames(live, outcome.ticketId)).includes("live-n05.png"));
});

liveTest("LIVE-N06", "新規ticket本文の複数Markdown imageをそれぞれuploadする", async (live) => {
  writeFile(live, "live-n06-a.png", pngBytes);
  writeFile(live, "live-n06-b.png", pngBytes);
  const key = await live.queueNewTicket({
    subject: `LIVE-N06 ${Date.now()}`,
    description: "複数 ![a](./live-n06-a.png) ![b](./live-n06-b.png)",
    baseDir: live.directory,
  });

  const outcome = await live.engine().syncOne(key, live.context);
  assertCompleted(outcome);
  if (outcome.kind !== "completed") { return; }
  const remote = await live.readIssue(outcome.ticketId);
  assert.strictEqual(uploadCount(live), 2);
  assert.ok(remote.ticket.description?.includes("live-n06-a.png"));
  assert.ok(remote.ticket.description?.includes("live-n06-b.png"));
  const names = await uploadedAttachmentNames(live, outcome.ticketId);
  assert.ok(names.includes("live-n06-a.png"));
  assert.ok(names.includes("live-n06-b.png"));
});

liveTest("LIVE-N07", "新規ticket本文の同名Markdown imageを衝突しない名前で添付する", async (live) => {
  writeFile(live, "left/screen.png", pngBytes);
  writeFile(live, "right/screen.png", Buffer.from(pngBytes).map((byte, index) => byte ^ (index === 30 ? 1 : 0)));
  const key = await live.queueNewTicket({
    subject: `LIVE-N07 ${Date.now()}`,
    description: "衝突 ![left](./left/screen.png) ![right](./right/screen.png)",
    baseDir: live.directory,
  });

  const outcome = await live.engine().syncOne(key, live.context);
  assertCompleted(outcome);
  if (outcome.kind !== "completed") { return; }
  const remote = await live.readIssue(outcome.ticketId);
  const names = await uploadedAttachmentNames(live, outcome.ticketId);
  const renamed = names.filter((name) => name.startsWith("screen"));
  assert.strictEqual(uploadCount(live), 2);
  assert.strictEqual(new Set(renamed).size, 2);
  assert.ok(remote.ticket.description?.includes("screen"));
  assert.ok(!remote.ticket.description?.includes("./left/screen.png"));
  assert.ok(!remote.ticket.description?.includes("./right/screen.png"));
});

liveTest("LIVE-N08", "新規ticket作成時に子ticketを作成する", async (live) => {
  const subject = `LIVE-N08 parent ${Date.now()}`;
  const childSubject = `LIVE-N08 child ${Date.now()}`;
  const key = await live.queueNewTicket({
    subject,
    metadata: { ...live.metadata, children: [childSubject] },
  });

  const outcome = await live.engine().syncOne(key, live.context);
  assertCompleted(outcome);
  if (outcome.kind !== "completed") { return; }
  const children = await live.request<{
    issues: Array<{ id: number; subject: string; parent?: { id: number } }>;
  }>({ method: "GET", path: "/issues.json", query: { project_id: live.projectId, parent_id: outcome.ticketId, limit: 100 } });
  const child = children.issues.find((issue) => issue.subject === childSubject);
  assert.ok(child);
  assert.strictEqual(child?.parent?.id, outcome.ticketId);
  assert.strictEqual((await live.readIssue(child!.id)).ticket.parentId, outcome.ticketId);
});

liveTest("LIVE-N09", "既存ticketの日本語本文と改行を更新する", async (live) => {
  const issueId = await live.createIssue();
  const subject = `LIVE-N09 更新後 ${Date.now()}`;
  const description = "更新した説明\n2行目\n\n終端";
  const key = await live.queueTicket(issueId, { subject, description });

  const outcome = await live.engine().syncOne(key, live.context);
  assertCompleted(outcome);
  const remote = await live.readIssue(issueId);
  assert.strictEqual(remote.ticket.subject, subject);
  assert.strictEqual(lf(remote.ticket.description), description);
});

liveTest("LIVE-N10", "既存ticketのmetadataを更新する", async (live) => {
  const issueId = await live.createIssue();
  const key = await live.queueTicket(issueId, {
    metadata: { ...live.metadata, due_date: "2026-11-20", start_date: "2026-11-01", done_ratio: 60, estimated_hours: 4 },
  });

  const outcome = await live.engine().syncOne(key, live.context);
  assertCompleted(outcome);
  const remote = await live.readIssue(issueId);
  assert.strictEqual(remote.ticket.dueDate, "2026-11-20");
  assert.strictEqual(remote.ticket.startDate, "2026-11-01");
  assert.strictEqual(remote.ticket.doneRatio, 60);
  assert.strictEqual(remote.ticket.estimatedHours, 4);
});

liveTest("LIVE-N11", "変更のないticket updateはno_changeになる", async (live) => {
  const issueId = await live.createIssue();
  const key = await live.queueTicket(issueId, {});

  const outcome = await live.engine().syncOne(key, live.context);
  assert.ok(outcome.kind === "no_change" || outcome.kind === "completed");
  assert.strictEqual(live.proxy.hits().filter((hit) => hit.method === "PUT" && hit.path === `/issues/${issueId}.json`).length, 0);
});

liveTest("LIVE-N12", "既存ticket updateにfile attachmentを追加する", async (live) => {
  const issueId = await live.createIssue();
  const filePath = writeFile(live, "live-n12.txt", "LIVE-N12 update attachment");
  const key = await live.queueTicket(issueId, { attachments: [{ kind: "file", filePath }] });

  const outcome = await live.engine().syncOne(key, live.context);
  assertCompleted(outcome);
  assert.ok((await uploadedAttachmentNames(live, issueId)).includes("live-n12.txt"));
  assert.strictEqual(uploadCount(live), 1);
});

liveTest("LIVE-N13", "既存ticket updateにclipboard imageを追加する", async (live) => {
  const issueId = await live.createIssue();
  const key = await live.queueTicket(issueId, {
    attachments: [{ kind: "clipboard", filename: "live-n13.png", contentType: "image/png" }],
  });

  await withClipboard(`data:image/png;base64,${pngBytes.toString("base64")}`, async () => {
    const outcome = await live.engine().syncOne(key, live.context);
    assertCompleted(outcome);
    assert.ok((await uploadedAttachmentNames(live, issueId)).includes("live-n13.png"));
    assert.strictEqual(uploadCount(live), 1);
  });
});

liveTest("LIVE-N14", "既存ticket updateに事前upload済みtokenを添付する", async (live) => {
  const issueId = await live.createIssue();
  const filePath = writeFile(live, "live-n14-token.txt", "LIVE-N14 token attachment");
  const uploaded = await live.run(() => uploadFileAttachment(filePath));
  const key = await live.queueTicket(issueId, {
    uploadTokens: [{ token: uploaded.token, filename: uploaded.filename, content_type: uploaded.contentType }],
  });

  const outcome = await live.engine().syncOne(key, live.context);
  assertCompleted(outcome);
  assert.ok((await uploadedAttachmentNames(live, issueId)).includes("live-n14-token.txt"));
  assert.strictEqual(uploadCount(live), 1);
});

liveTest("LIVE-N15", "既存ticket本文の同じMarkdown image参照を一度だけuploadする", async (live) => {
  const issueId = await live.createIssue();
  writeFile(live, "live-n15.png", pngBytes);
  const key = await live.queueTicket(issueId, {
    description: "更新画像 ![one](./live-n15.png) と ![two](./live-n15.png)",
    baseDir: live.directory,
  });

  const outcome = await live.engine().syncOne(key, live.context);
  assertCompleted(outcome);
  const remote = await live.readIssue(issueId);
  assert.strictEqual(uploadCount(live), 1);
  assert.ok(remote.ticket.description?.includes("![one](live-n15.png)"));
  assert.ok(remote.ticket.description?.includes("![two](live-n15.png)"));
  assert.ok((await uploadedAttachmentNames(live, issueId)).includes("live-n15.png"));
});

liveTest("LIVE-N16", "既存ticket updateで複数Markdown imageと同名衝突を処理する", async (live) => {
  const issueId = await live.createIssue();
  writeFile(live, "left/screen.png", pngBytes);
  writeFile(live, "right/screen.png", Buffer.from(pngBytes).map((byte, index) => byte ^ (index === 30 ? 1 : 0)));
  const key = await live.queueTicket(issueId, {
    description: "更新画像 ![left](./left/screen.png) ![right](./right/screen.png)",
    baseDir: live.directory,
  });

  const outcome = await live.engine().syncOne(key, live.context);
  assertCompleted(outcome);
  const remote = await live.readIssue(issueId);
  const names = (await uploadedAttachmentNames(live, issueId)).filter((name) => name.startsWith("screen"));
  assert.strictEqual(uploadCount(live), 2);
  assert.strictEqual(new Set(names).size, 2);
  assert.ok(remote.ticket.description?.includes("screen"));
  assert.ok(!remote.ticket.description?.includes("./left/screen.png"));
  assert.ok(!remote.ticket.description?.includes("./right/screen.png"));
});

liveTest("LIVE-N17", "既存ticket update時に子ticketを追加する", async (live) => {
  const issueId = await live.createIssue();
  const childSubject = `LIVE-N17 child ${Date.now()}`;
  const key = await live.queueTicket(issueId, {
    metadata: { ...live.metadata, children: [childSubject] },
  });

  const outcome = await live.engine().syncOne(key, live.context);
  assertCompleted(outcome);
  const children = await live.request<{
    issues: Array<{ id: number; subject: string; parent?: { id: number } }>;
  }>({ method: "GET", path: "/issues.json", query: { project_id: live.projectId, parent_id: issueId, limit: 100 } });
  const child = children.issues.find((issue) => issue.subject === childSubject);
  assert.ok(child);
  assert.strictEqual(child?.parent?.id, issueId);
  assert.strictEqual((await live.readIssue(child!.id)).ticket.parentId, issueId);
});

liveTest("LIVE-N18", "新規commentの日本語本文と改行を作成する", async (live) => {
  const issueId = await live.createIssue();
  const body = `LIVE-N18 コメント\n2行目\n\n最後 ${Date.now()}`;
  const key = await live.queueComment(issueId, body);

  const outcome = await live.engine().syncOne(key, live.context);
  assertCompleted(outcome);
  assert.ok((await live.readIssue(issueId)).comments.some((comment) => comment.body === body));
});

liveTest("LIVE-N19", "既存commentを日本語と改行を保って更新する", async (live) => {
  const issueId = await live.createIssue();
  const baseBody = `LIVE-N19 base ${Date.now()}`;
  const createKey = await live.queueComment(issueId, baseBody);
  const created = await live.engine().syncOne(createKey, live.context);
  assertCompleted(created);
  const comment = (await live.readIssue(issueId)).comments.find((candidate) => candidate.body === baseBody);
  assert.ok(comment);
  const body = `LIVE-N19 更新済み\n日本語の2行目\n\n${Date.now()}`;
  const key = await live.queueComment(issueId, body, {
    commentId: comment!.id,
    baseBody,
    lastKnownRemoteUpdatedAt: comment!.updatedAt,
  });

  assertCompleted(await live.engine().syncOne(key, live.context));
  assert.strictEqual((await live.readIssue(issueId)).comments.find((candidate) => candidate.id === comment!.id)?.body, body);
});

liveTest("LIVE-N20", "本文が変わらないcomment updateはno_changeになる", async (live) => {
  const issueId = await live.createIssue();
  const body = `LIVE-N20 unchanged ${Date.now()}`;
  const createKey = await live.queueComment(issueId, body);
  assertCompleted(await live.engine().syncOne(createKey, live.context));
  const comment = (await live.readIssue(issueId)).comments.find((candidate) => candidate.body === body);
  assert.ok(comment);
  const key = await live.queueComment(issueId, body, {
    commentId: comment!.id,
    baseBody: body,
    lastKnownRemoteUpdatedAt: comment!.updatedAt,
  });

  live.proxy.reset();
  const outcome = await live.engine().syncOne(key, live.context);
  assert.strictEqual(outcome.kind, "no_change");
  assert.strictEqual(live.proxy.hits().filter((hit) => hit.method === "PUT" && hit.path === `/issues/${issueId}.json`).length, 0);
});

liveTest("LIVE-N21", "新規comment本文の重複Markdown image参照を一度だけuploadする", async (live) => {
  const issueId = await live.createIssue();
  writeFile(live, "live-n21.png", pngBytes);
  const body = `LIVE-N21 image ![one](./live-n21.png) ![two](./live-n21.png)`;
  const key = await live.queueComment(issueId, body, { baseDir: live.directory });

  assertCompleted(await live.engine().syncOne(key, live.context));
  const remoteComment = (await live.readIssue(issueId)).comments.find((comment) => comment.body.includes("LIVE-N21 image"));
  assert.ok(remoteComment);
  assert.strictEqual(uploadCount(live), 1);
  assert.ok(remoteComment?.body.includes("![one](live-n21.png)"));
  assert.ok(remoteComment?.body.includes("![two](live-n21.png)"));
});

liveTest("LIVE-N22", "comment updateで複数Markdown imageの同名衝突を解決する", async (live) => {
  const issueId = await live.createIssue();
  const baseBody = `LIVE-N22 base ${Date.now()}`;
  const createKey = await live.queueComment(issueId, baseBody);
  assertCompleted(await live.engine().syncOne(createKey, live.context));
  const original = (await live.readIssue(issueId)).comments.find((comment) => comment.body === baseBody);
  assert.ok(original);
  writeFile(live, "left/screen.png", pngBytes);
  writeFile(live, "right/screen.png", Buffer.from(pngBytes).map((byte, index) => byte ^ (index === 30 ? 1 : 0)));
  const body = `LIVE-N22 更新 ![left](./left/screen.png) ![right](./right/screen.png)`;
  const key = await live.queueComment(issueId, body, {
    commentId: original!.id,
    baseBody,
    baseDir: live.directory,
    lastKnownRemoteUpdatedAt: original!.updatedAt,
  });

  assertCompleted(await live.engine().syncOne(key, live.context));
  const updated = (await live.readIssue(issueId)).comments.find((comment) => comment.id === original!.id);
  assert.ok(updated);
  assert.strictEqual(uploadCount(live), 2);
  assert.ok(updated?.body.includes("screen"));
  assert.ok(!updated?.body.includes("./left/screen.png"));
  assert.ok(!updated?.body.includes("./right/screen.png"));
});
