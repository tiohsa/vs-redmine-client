import * as assert from "assert";
import { DashboardController } from "../dashboard/DashboardController";
import { DashboardStateStore } from "../dashboard/DashboardStateStore";

suite("Dashboard settings reload", () => {
  test("settings.updateGeneral は自身で Ticket reload を追加実行しない", async () => {
    const controller = new DashboardController({
      store: new DashboardStateStore(),
      notifyOperationStarted: () => undefined,
      notifySuccess: () => undefined,
      notifyError: () => undefined,
      notifyToast: () => undefined,
      onTicketsRefreshed: () => undefined,
    });
    let updateCount = 0;
    let reloadCount = 0;
    controller["settingsCtrl"].updateGeneral = async () => {
      updateCount++;
    };
    controller["ticketService"].loadTickets = async () => {
      reloadCount++;
    };

    await controller.handle({
      type: "settings.updateGeneral",
      requestId: "settings-update",
      patch: { ticketListLimit: 100 },
    });

    assert.strictEqual(updateCount, 1);
    assert.strictEqual(reloadCount, 0);
    controller.dispose();
  });
});
