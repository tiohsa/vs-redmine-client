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
    const target = controller as unknown as {
      settingsCtrl: { updateGeneral(patch: unknown): Promise<void> };
      loadTickets(): Promise<void>;
    };
    let reloadCount = 0;
    target.settingsCtrl = { updateGeneral: async () => undefined };
    target.loadTickets = async () => {
      reloadCount++;
    };

    await controller.handle({
      type: "settings.updateGeneral",
      requestId: "settings-update",
      patch: { ticketListLimit: 100 },
    });

    assert.strictEqual(reloadCount, 0);
    controller.dispose();
  });
});
