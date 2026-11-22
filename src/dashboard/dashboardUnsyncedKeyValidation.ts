import type { DashboardUnsyncedKey } from "./dashboardProtocol";
import { isNonEmptyString, isNumber, isObject, isPositiveInt, isString } from "./dashboardValidationPrimitives";

const UNSYNCED_KINDS = new Set(["ticket", "newTicket", "comment"]);

export const validateDashboardUnsyncedKey = (v: unknown): v is DashboardUnsyncedKey => {
  if (!isObject(v)) { return false; }
  const kind = v["kind"];
  if (!isString(kind) || !UNSYNCED_KINDS.has(kind)) { return false; }
  if (kind === "ticket") {
    if (!isPositiveInt(v["ticketId"])) { return false; }
    if ("operationId" in v && !isNonEmptyString(v["operationId"])) { return false; }
    if ("abandonedAt" in v && (!isNumber(v["abandonedAt"]) || v["abandonedAt"] < 0)) { return false; }
  }
  if (kind === "newTicket") {
    if ("queueId" in v && !isNonEmptyString(v["queueId"])) { return false; }
    if ("documentUri" in v && !isNonEmptyString(v["documentUri"])) { return false; }
    if (!isNonEmptyString(v["queueId"]) && !isNonEmptyString(v["documentUri"])) { return false; }
  }
  if (kind === "comment") {
    if (!isPositiveInt(v["ticketId"])) { return false; }
    if ("commentId" in v && !isPositiveInt(v["commentId"])) { return false; }
    if ("documentUri" in v && !isNonEmptyString(v["documentUri"])) { return false; }
    if ("operationId" in v && !isNonEmptyString(v["operationId"])) { return false; }
    if (!("commentId" in v) && !("documentUri" in v) && !("operationId" in v)) { return false; }
  }
  return true;
};

