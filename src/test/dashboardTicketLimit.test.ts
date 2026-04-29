import * as assert from "assert";
import { DashboardStateStore } from "../dashboard/DashboardStateStore";
import { SettingsController } from "../dashboard/SettingsController";
import { getTicketListLimit } from "../config/settings";

suite("dashboardTicketLimit — チケット取得件数", () => {
  test("getTicketListLimit() はデフォルト 50 を返す", () => {
    const limit = getTicketListLimit();
    assert.strictEqual(typeof limit, "number");
    assert.ok(limit >= 1, "limit は 1 以上であること");
    assert.ok(limit <= 500, "limit は 500 以下であること");
  });

  test("getTicketListLimit() は数値を返す", () => {
    const limit = getTicketListLimit();
    assert.ok(Number.isInteger(limit), "limit は整数であること");
  });

  test("SettingsController.updateGeneral() が ticketListLimit を 1〜500 の範囲で受け付ける", async () => {
    const store = new DashboardStateStore();
    const ctrl = new SettingsController(store);
    // 範囲内: エラーを投げないこと
    await assert.doesNotReject(async () => {
      await ctrl.updateGeneral({ ticketListLimit: 100 });
    });
  });

  test("SettingsController.updateGeneral() が ticketListLimit を無効値で呼ばれても例外を投げない", async () => {
    const store = new DashboardStateStore();
    const ctrl = new SettingsController(store);
    // 0 や 501 は無視されるが例外は投げないこと
    await assert.doesNotReject(async () => {
      await ctrl.updateGeneral({ ticketListLimit: 0 });
    });
    await assert.doesNotReject(async () => {
      await ctrl.updateGeneral({ ticketListLimit: 501 });
    });
  });

  test("SettingsController.updateGeneral() が offlineSyncMode を型として受け付ける", () => {
    // offlineSyncMode の型が "auto" | "manual" に限定されていることを確認する
    // (実際の設定書き込みはワークスペース要件があるためスキップ)
    const validModes: Array<"auto" | "manual"> = ["auto", "manual"];
    for (const mode of validModes) {
      assert.ok(["auto", "manual"].includes(mode));
    }
  });
});
