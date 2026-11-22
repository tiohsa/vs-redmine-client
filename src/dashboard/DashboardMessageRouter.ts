import type { DashboardController } from "./DashboardController";
import { validateDashboardMessage } from "./dashboardMessageValidation";
import { logOperation } from "../utils/redmineLogger";

/** Webview からのメッセージをバリデートして Controller に委譲する */
export class DashboardMessageRouter {
  constructor(private readonly controller: DashboardController) {}

  async route(raw: unknown, onDashboardReady?: () => void): Promise<void> {
    const result = validateDashboardMessage(raw);
    if (!result.ok) {
      logOperation({
        operation_type: "dashboard.message.invalid",
        request_time: new Date().toISOString(),
        message: result.reason,
      });
      return;
    }
    if (result.request.type === "dashboard.ready") {
      onDashboardReady?.();
    }
    await this.controller.handle(result.request);
  }
}
