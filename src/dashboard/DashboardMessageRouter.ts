import type { DashboardController } from "./DashboardController";
import { validateDashboardMessage } from "./dashboardMessageValidation";

/** Webview からのメッセージをバリデートして Controller に委譲する */
export class DashboardMessageRouter {
  constructor(private readonly controller: DashboardController) {}

  async route(raw: unknown): Promise<void> {
    const result = validateDashboardMessage(raw);
    if (!result.ok) {
      return;
    }
    await this.controller.handle(result.request);
  }
}
