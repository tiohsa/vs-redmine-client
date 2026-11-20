import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { createTicketSyncService } from "../../app/ticketSync";
import { createTicketFromEditor } from "../../commands/createTicket";
import { createTicketFromMarkdownHeader } from "../../commands/createTicketFromMarkdownHeader";
import { syncEditorToRedmine } from "../../commands/syncToRedmine";
import { resolveEditorBaseDir } from "../../utils/editorBaseDir";
import { previewMarkdownTicketCreation } from "../../views/markdownTicketCreateService";
import { getOfflineSyncQueue } from "../../views/offlineSyncStore";
import {
  buildNewTicketDraftContent,
  initializeTicketDraft,
} from "../../views/ticketDraftStore";
import {
  buildTicketEditorContent,
  parseTicketEditorContent,
} from "../../views/ticketEditorContent";
import {
  getTicketEditorDefaults,
  resetTicketEditorDefaultFields,
  resetTicketEditorDefaults,
  setTicketEditorDefaults,
  updateTicketEditorDefaultField,
} from "../../views/ticketEditorDefaultsStore";
import {
  NEW_TICKET_DRAFT_ID,
  registerTicketEditor,
} from "../../views/ticketEditorRegistry";
import { metadataFromTicket } from "../../views/ticketSync/ticketRemoteContent";
import { liveTest, type LiveFixture } from "./liveFixture";

const lf = (text: string | undefined): string | undefined => text?.replace(/\r\n/g, "\n");

const openMarkdownEditor = async (
  live: LiveFixture,
  fileName: string,
  content: string,
): Promise<vscode.TextEditor> => {
  const uri = vscode.Uri.file(path.join(live.directory, fileName));
  fs.mkdirSync(path.dirname(uri.fsPath), { recursive: true });
  fs.writeFileSync(uri.fsPath, content, "utf8");
  const document = await vscode.workspace.openTextDocument(uri);
  return vscode.window.showTextDocument(document, { preview: false });
};

liveTest("LIVE-W01", "Markdownヘッダーからチケットを作成して実Redmineへ同期しFrontmatterを更新する", async (live) => {
  const subject = `LIVE-W01 header create ${Date.now()}`;
  const description = "Created from Markdown header\nSecond line";
  const content = buildTicketEditorContent({
    subject,
    description,
    metadata: { ...live.metadata },
    controlFields: {
      mode: "new-ticket",
      project_id: live.projectId,
    },
  });
  const editor = await openMarkdownEditor(live, `header-create-${Date.now()}.md`, content);

  const successes: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  await live.run(() =>
    createTicketFromMarkdownHeader({
      getActiveEditor: () => editor,
      previewCreation: previewMarkdownTicketCreation,
      confirmCreation: async (preview) => {
        assert.strictEqual(preview.projectId, live.projectId);
        assert.strictEqual(preview.subject, subject);
        return true;
      },
      showError: (message) => errors.push(message),
      showWarning: (message) => warnings.push(message),
      showSuccess: (message) => successes.push(message),
      resolveBaseDir: (target) => resolveEditorBaseDir({ editor: target }),
      syncTicket: ({ editor: target, projectId, connectionScope }) =>
        createTicketSyncService().syncEditor({
          context: { connectionScope },
          editor: target,
          ticketId: 0,
          newTicket: true,
          manual: false,
          projectId,
        }),
    }),
  );

  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(warnings, []);
  assert.strictEqual(successes.length, 1);

  const updated = parseTicketEditorContent(editor.document.getText());
  const issueId = updated.controlFields?.issue_id;
  assert.strictEqual(typeof issueId, "number");
  assert.ok(issueId && issueId > 0);
  assert.strictEqual(updated.controlFields?.mode, "ticket-update");
  assert.strictEqual(updated.controlFields?.project_id, live.projectId);

  const remote = await live.readIssue(issueId);
  assert.strictEqual(remote.ticket.subject, subject);
  assert.strictEqual(lf(remote.ticket.description), description);
  assert.strictEqual(remote.ticket.trackerName, live.metadata.tracker);
  assert.strictEqual(remote.ticket.priorityName, live.metadata.priority);
  assert.strictEqual(remote.ticket.statusName, live.metadata.status);
});

liveTest("LIVE-W02", "MarkdownドキュメントへRedmineチケット用Frontmatterを挿入する", async (live) => {
  resetTicketEditorDefaults();
  try {
    setTicketEditorDefaults({
      subject: "",
      description: "",
      metadata: { ...live.metadata },
    });

    const editor = await openMarkdownEditor(
      live,
      `insert-frontmatter-${Date.now()}.md`,
      "# Feature from Markdown\n\nBody paragraph.\n",
    );

    await vscode.commands.executeCommand("redmine-client.insertRedmineTicketFrontmatter");

    const text = editor.document.getText();
    assert.ok(text.includes("mode: new-ticket"));
    assert.ok(text.includes(`project_id: ${live.projectId}`));
    assert.ok(text.includes(`tracker:   ${live.metadata.tracker}`));
    assert.ok(text.includes(`priority:  ${live.metadata.priority}`));
    assert.ok(text.includes(`status:    ${live.metadata.status}`));
    assert.ok(text.includes("# Feature from Markdown"));
    assert.ok(text.includes("Body paragraph."));

    const preview = previewMarkdownTicketCreation(text);
    assert.strictEqual(preview.projectId, live.projectId);
    assert.strictEqual(preview.subject, "Feature from Markdown");
  } finally {
    resetTicketEditorDefaults();
  }
});

liveTest("LIVE-W03", "実VS Codeエディタで既存チケットを編集しauto保存で実Redmineへ同期する", async (live) => {
  const id = await live.createIssue({
    subject: `LIVE-W03 initial ${Date.now()}`,
    description: "Initial remote body",
  });
  const detail = await live.readIssue(id);
  const metadata = metadataFromTicket(detail.ticket);
  const initialContent = buildTicketEditorContent({
    subject: detail.ticket.subject,
    description: detail.ticket.description ?? "",
    metadata,
    controlFields: {
      mode: "ticket-update",
      project_id: live.projectId,
      issue_id: id,
      last_synced_at: detail.ticket.updatedAt,
    },
  });

  const editor = await openMarkdownEditor(live, `edit-existing-${id}.md`, initialContent);
  registerTicketEditor(id, editor, "primary", "ticket", live.projectId, live.scope);
  initializeTicketDraft(
    id,
    detail.ticket.subject,
    detail.ticket.description ?? "",
    metadata,
    detail.ticket.updatedAt,
    live.scope,
  );

  const updatedSubject = `${detail.ticket.subject} edited`;
  const updatedDescription = "Updated body from real editor\nLine 2";
  const nextContent = buildTicketEditorContent({
    subject: updatedSubject,
    description: updatedDescription,
    metadata,
    controlFields: {
      mode: "ticket-update",
      project_id: live.projectId,
      issue_id: id,
      last_synced_at: detail.ticket.updatedAt,
    },
  });

  const fullRange = new vscode.Range(
    editor.document.positionAt(0),
    editor.document.positionAt(editor.document.getText().length),
  );
  const applied = await editor.edit((editBuilder) => {
    editBuilder.replace(fullRange, nextContent);
  });
  assert.strictEqual(applied, true);
  const configuration = vscode.workspace.getConfiguration("redmine-client");
  const previousMode = configuration.inspect<string>("offlineSyncMode")?.workspaceValue;
  try {
    await configuration.update("offlineSyncMode", "auto", vscode.ConfigurationTarget.Workspace);
    assert.ok(await editor.document.save());
    const deadline = Date.now() + 15_000;
    let remote = await live.readIssue(id);
    while (Date.now() < deadline &&
      (remote.ticket.subject !== updatedSubject || getOfflineSyncQueue(live.scope).tickets.has(id))) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      remote = await live.readIssue(id);
    }
    assert.strictEqual(remote.ticket.subject, updatedSubject);
    assert.strictEqual(lf(remote.ticket.description), updatedDescription);
    assert.strictEqual(getOfflineSyncQueue(live.scope).tickets.has(id), false);
  } finally {
    await configuration.update("offlineSyncMode", previousMode, vscode.ConfigurationTarget.Workspace);
  }
});

liveTest("LIVE-W04", "エディタデフォルト設定を新規チケット作成ワークフローへ適用しリセットできる", async (live) => {
  resetTicketEditorDefaults();
  try {
    const defaultSubject = `LIVE-W04 default ${Date.now()}`;
    const defaultDescription = "Default body line 1\nDefault body line 2";
    const defaultDueDate = "2026-12-15";

    updateTicketEditorDefaultField("subject", defaultSubject);
    updateTicketEditorDefaultField("description", defaultDescription);
    updateTicketEditorDefaultField("tracker", live.metadata.tracker);
    updateTicketEditorDefaultField("priority", live.metadata.priority);
    updateTicketEditorDefaultField("status", live.metadata.status);
    updateTicketEditorDefaultField("due_date", defaultDueDate);

    const draft = buildNewTicketDraftContent({ projectId: live.projectId });
    assert.strictEqual(draft.subject, defaultSubject);
    assert.strictEqual(draft.description, defaultDescription);
    assert.strictEqual(draft.metadata.tracker, live.metadata.tracker);
    assert.strictEqual(draft.metadata.priority, live.metadata.priority);
    assert.strictEqual(draft.metadata.status, live.metadata.status);
    assert.strictEqual(draft.metadata.due_date, defaultDueDate);

    const editor = await openMarkdownEditor(
      live,
      `defaults-new-${Date.now()}.md`,
      buildTicketEditorContent(draft),
    );
    registerTicketEditor(NEW_TICKET_DRAFT_ID, editor, "primary", "ticket", live.projectId, live.scope);

    const syncResult = await syncEditorToRedmine(editor, {
      trigger: "explicit",
      syncEngine: live.engine(),
    });
    assert.strictEqual(syncResult?.kind, "ticket");
    assert.strictEqual(syncResult?.result.status, "created");

    const createdId = parseTicketEditorContent(editor.document.getText()).controlFields?.issue_id;
    assert.strictEqual(typeof createdId, "number");
    assert.ok(createdId && createdId > 0);
    const remote = await live.readIssue(createdId);
    assert.strictEqual(remote.ticket.subject, defaultSubject);
    assert.strictEqual(lf(remote.ticket.description), defaultDescription);
    assert.strictEqual(remote.ticket.trackerName, live.metadata.tracker);
    assert.strictEqual(remote.ticket.priorityName, live.metadata.priority);
    assert.strictEqual(remote.ticket.statusName, live.metadata.status);
    assert.strictEqual(remote.ticket.dueDate, defaultDueDate);

    resetTicketEditorDefaultFields(["subject", "due_date"]);
    const partialReset = getTicketEditorDefaults();
    assert.strictEqual(partialReset.subject, "");
    assert.strictEqual(partialReset.metadata.due_date, "");
    assert.strictEqual(partialReset.description, defaultDescription);

    resetTicketEditorDefaults();
    const afterFullReset = buildNewTicketDraftContent({ projectId: live.projectId });
    assert.strictEqual(afterFullReset.subject, "");
    assert.strictEqual(afterFullReset.description, "");
  } finally {
    resetTicketEditorDefaults();
  }
});

liveTest("LIVE-W05", "実Markdown文書の相対画像をRedmineへ同期する", async (live) => {
  const filename = "workflow-image.png";
  fs.writeFileSync(path.join(live.directory, filename), Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pHsAAAAASUVORK5CYII=",
    "base64",
  ));
  const content = buildTicketEditorContent({
    ...buildNewTicketDraftContent({ projectId: live.projectId }),
    subject: "LIVE-W05 Markdown conversion",
    description: "![diagram](./workflow-image.png)",
    metadata: live.metadata,
  });
  const editor = await openMarkdownEditor(live, "workflow-image.md", content);
  registerTicketEditor(NEW_TICKET_DRAFT_ID, editor, "primary", "ticket", live.projectId, live.scope);
  const result = await syncEditorToRedmine(editor, { trigger: "explicit", syncEngine: live.engine() });
  assert.strictEqual(result?.result.status, "created");
  const issueId = parseTicketEditorContent(editor.document.getText()).controlFields?.issue_id;
  assert.ok(issueId);
  const { issue } = await live.request<{ issue: { description: string; attachments: { filename: string }[] } }>({
    method: "GET", path: `/issues/${issueId}.json`, query: { include: "attachments" },
  });
  assert.deepStrictEqual(issue.attachments.map((attachment) => attachment.filename), [filename]);
  assert.ok(issue.description.includes(`![diagram](${filename})`));
});

liveTest("LIVE-W06", "Markdownからの直接作成でMermaidをRedmine用の形式に変換する", async (live) => {
  const previous = getTicketEditorDefaults();
  try {
    setTicketEditorDefaults({ ...previous, metadata: live.metadata });
    const subject = "LIVE-W06 Mermaid conversion";
    const editor = await openMarkdownEditor(live, "workflow-mermaid.md",
      ["```mermaid", "graph LR", "  A --> B", "```"].join("\n"));
    await createTicketFromEditor({
      getActiveEditor: () => editor,
      promptSubject: async () => subject,
      promptAttachments: async () => [],
      getDefaultProjectId: () => String(live.projectId),
    });
    const issueId = parseTicketEditorContent(editor.document.getText()).controlFields?.issue_id;
    assert.ok(issueId);
    const { ticket } = await live.readIssue(issueId);
    assert.strictEqual(ticket.subject, subject);
    assert.match(lf(ticket.description) ?? "", /\{\{mermaid\ngraph LR\n\s+A --> B\n\}\}/);
  } finally {
    setTicketEditorDefaults(previous);
  }
});
