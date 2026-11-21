import * as assert from "assert";
import * as vscode from "vscode";
import { createPendingDocumentChangeScheduler } from "../app/editorDocumentChangeScheduler";
import { createDocumentStub } from "./helpers/editorStubs";

suite("editor document change scheduler", () => {
  test("URI ごとに保留変更を分離して flush する", () => {
    const first = createDocumentStub(vscode.Uri.parse("untitled:first.md"), "first");
    const second = createDocumentStub(vscode.Uri.parse("untitled:second.md"), "second");
    const changed: vscode.TextDocument[] = [];
    const scheduler = createPendingDocumentChangeScheduler((document) => changed.push(document));

    scheduler.schedule(first);
    scheduler.schedule(second);
    scheduler.flush(first.uri.toString());

    assert.deepStrictEqual(changed, [first]);
    scheduler.flushAll();
    assert.deepStrictEqual(changed, [first, second]);
    scheduler.dispose();
  });

  test("同一 URI の変更は最新文書だけを反映する", () => {
    const uri = vscode.Uri.parse("untitled:ticket.md");
    const earlier = createDocumentStub(uri, "earlier");
    const latest = createDocumentStub(uri, "latest");
    const changed: vscode.TextDocument[] = [];
    const scheduler = createPendingDocumentChangeScheduler((document) => changed.push(document));

    scheduler.schedule(earlier);
    scheduler.schedule(latest);
    scheduler.flush(uri.toString());

    assert.deepStrictEqual(changed, [latest]);
    scheduler.dispose();
  });

  test("閉じた文書の保留変更は破棄する", () => {
    const document = createDocumentStub(vscode.Uri.parse("untitled:closed.md"), "closed");
    const changed: vscode.TextDocument[] = [];
    const scheduler = createPendingDocumentChangeScheduler((next) => changed.push(next));

    scheduler.schedule(document);
    scheduler.clear(document.uri.toString());
    scheduler.flushAll();

    assert.deepStrictEqual(changed, []);
    scheduler.dispose();
  });
});
