import * as assert from "assert";
import { resolveCurrentProject } from "../dashboard/resolveProject";
import type { DashboardProjectNode } from "../dashboard/dashboardProtocol";

const makeNode = (id: number, name: string): DashboardProjectNode => ({
  id,
  name,
  identifier: `proj-${id}`,
  level: 0,
});

suite("プロジェクト解決 — resolveCurrentProject", () => {
  test("選択済みプロジェクト ID が優先される", () => {
    const result = resolveCurrentProject({
      selectionId: 10,
      selectionName: "Selected Project",
      defaultProjectId: "5",
      projects: [makeNode(5, "Default")],
    });
    assert.strictEqual(result?.id, 10);
    assert.strictEqual(result?.name, "Selected Project");
  });

  test("選択なし時は defaultProjectId が使われる", () => {
    const result = resolveCurrentProject({
      selectionId: undefined,
      defaultProjectId: "5",
      projects: [],
    });
    assert.strictEqual(result?.id, 5);
  });

  test("defaultProjectId に一致するプロジェクトからプロジェクト名を解決する", () => {
    const result = resolveCurrentProject({
      selectionId: undefined,
      defaultProjectId: "5",
      projects: [makeNode(5, "マイプロジェクト")],
    });
    assert.strictEqual(result?.id, 5);
    assert.strictEqual(result?.name, "マイプロジェクト");
  });

  test("選択なし・defaultProjectId なしの場合は undefined", () => {
    const result = resolveCurrentProject({
      selectionId: undefined,
      defaultProjectId: "",
      projects: [],
    });
    assert.strictEqual(result, undefined);
  });

  test("defaultProjectId が undefined の場合は undefined", () => {
    const result = resolveCurrentProject({
      selectionId: undefined,
      defaultProjectId: undefined,
      projects: [],
    });
    assert.strictEqual(result, undefined);
  });

  test("defaultProjectId が数値に変換できない場合は undefined", () => {
    const result = resolveCurrentProject({
      selectionId: undefined,
      defaultProjectId: "not-a-number",
      projects: [],
    });
    assert.strictEqual(result, undefined);
  });

  test("defaultProjectId が 0 の場合は undefined", () => {
    const result = resolveCurrentProject({
      selectionId: undefined,
      defaultProjectId: "0",
      projects: [],
    });
    assert.strictEqual(result, undefined);
  });

  test("defaultProjectId が負の数の場合は undefined", () => {
    const result = resolveCurrentProject({
      selectionId: undefined,
      defaultProjectId: "-1",
      projects: [],
    });
    assert.strictEqual(result, undefined);
  });

  test("projectsリストに該当なしの場合はフォールバック名を使う", () => {
    const result = resolveCurrentProject({
      selectionId: undefined,
      defaultProjectId: "99",
      projects: [makeNode(1, "Other")],
    });
    assert.strictEqual(result?.id, 99);
    assert.strictEqual(result?.name, "Project #99");
  });

  test("selectionId が 0 の場合は defaultProjectId にフォールバックする", () => {
    const result = resolveCurrentProject({
      selectionId: 0,
      selectionName: "should be ignored",
      defaultProjectId: "7",
      projects: [makeNode(7, "Fallback")],
    });
    assert.strictEqual(result?.id, 7);
    assert.strictEqual(result?.name, "Fallback");
  });

  test("複数プロジェクトの中から正しい ID のプロジェクト名を選択する", () => {
    const result = resolveCurrentProject({
      selectionId: undefined,
      defaultProjectId: "3",
      projects: [makeNode(1, "First"), makeNode(3, "Third"), makeNode(5, "Fifth")],
    });
    assert.strictEqual(result?.id, 3);
    assert.strictEqual(result?.name, "Third");
  });
});
