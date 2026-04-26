import type { DashboardRequest, DashboardUnsyncedKey } from "./dashboardProtocol";

type ValidationResult =
  | { ok: true; request: DashboardRequest }
  | { ok: false; reason: string };

const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";
const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const UNSYNCED_KINDS = new Set(["ticket", "newTicket", "comment"]);

const validateUnsyncedKey = (v: unknown): v is DashboardUnsyncedKey => {
  if (!isObject(v)) { return false; }
  const kind = v["kind"];
  if (!isString(kind) || !UNSYNCED_KINDS.has(kind)) { return false; }
  if (kind === "ticket" && !isNumber(v["ticketId"])) { return false; }
  if (kind === "newTicket" && !isString(v["documentUri"])) { return false; }
  if (kind === "comment" && !isNumber(v["ticketId"])) { return false; }
  return true;
};

const validatePatch = (v: unknown): boolean => isObject(v);

export const validateDashboardMessage = (raw: unknown): ValidationResult => {
  if (!isObject(raw)) {
    return { ok: false, reason: "message is not an object" };
  }

  const type = raw["type"];
  const requestId = raw["requestId"];

  if (!isString(type)) {
    return { ok: false, reason: "type must be a string" };
  }
  if (!isString(requestId)) {
    return { ok: false, reason: "requestId must be a string" };
  }

  switch (type) {
    case "dashboard.ready":
    case "dashboard.refresh":
      return { ok: true, request: { type, requestId } };

    case "project.select": {
      const projectId = raw["projectId"];
      if (!isNumber(projectId)) {
        return { ok: false, reason: "project.select: projectId must be a number" };
      }
      return { ok: true, request: { type, requestId, projectId } };
    }

    case "project.toggleChildren": {
      const include = raw["includeChildProjects"];
      if (!isBoolean(include)) {
        return { ok: false, reason: "project.toggleChildren: includeChildProjects must be a boolean" };
      }
      return { ok: true, request: { type, requestId, includeChildProjects: include } };
    }

    case "tickets.refresh":
    case "tickets.loadMore":
      return { ok: true, request: { type, requestId } };

    case "ticket.select": {
      const ticketId = raw["ticketId"];
      if (!isNumber(ticketId)) {
        return { ok: false, reason: "ticket.select: ticketId must be a number" };
      }
      return { ok: true, request: { type, requestId, ticketId } };
    }

    case "ticket.openEditor": {
      const ticketId = raw["ticketId"];
      if (!isNumber(ticketId)) {
        return { ok: false, reason: "ticket.openEditor: ticketId must be a number" };
      }
      return { ok: true, request: { type, requestId, ticketId } };
    }

    case "ticket.openBrowser": {
      const ticketId = raw["ticketId"];
      if (!isNumber(ticketId)) {
        return { ok: false, reason: "ticket.openBrowser: ticketId must be a number" };
      }
      return { ok: true, request: { type, requestId, ticketId } };
    }

    case "ticket.create":
      return { ok: true, request: { type, requestId } };

    case "ticket.createChild": {
      const parentTicketId = raw["parentTicketId"];
      if (!isNumber(parentTicketId)) {
        return { ok: false, reason: "ticket.createChild: parentTicketId must be a number" };
      }
      return { ok: true, request: { type, requestId, parentTicketId } };
    }

    case "comment.add": {
      const ticketId = raw["ticketId"];
      if (!isNumber(ticketId)) {
        return { ok: false, reason: "comment.add: ticketId must be a number" };
      }
      return { ok: true, request: { type, requestId, ticketId } };
    }

    case "comment.edit": {
      const ticketId = raw["ticketId"];
      const commentId = raw["commentId"];
      if (!isNumber(ticketId)) {
        return { ok: false, reason: "comment.edit: ticketId must be a number" };
      }
      if (!isNumber(commentId)) {
        return { ok: false, reason: "comment.edit: commentId must be a number" };
      }
      return { ok: true, request: { type, requestId, ticketId, commentId } };
    }

    case "comment.reload": {
      const ticketId = raw["ticketId"];
      if (!isNumber(ticketId)) {
        return { ok: false, reason: "comment.reload: ticketId must be a number" };
      }
      return { ok: true, request: { type, requestId, ticketId } };
    }

    case "unsynced.openLocalFile": {
      const documentUri = raw["documentUri"];
      if (!isString(documentUri)) {
        return { ok: false, reason: "unsynced.openLocalFile: documentUri must be a string" };
      }
      return { ok: true, request: { type, requestId, documentUri } };
    }

    case "unsynced.syncOne": {
      const key = raw["key"];
      if (!validateUnsyncedKey(key)) {
        return { ok: false, reason: "unsynced.syncOne: key is invalid" };
      }
      return { ok: true, request: { type, requestId, key } };
    }

    case "unsynced.syncAll":
      return { ok: true, request: { type, requestId } };

    case "settings.update": {
      const patch = raw["patch"];
      if (!validatePatch(patch)) {
        return { ok: false, reason: "settings.update: patch must be an object" };
      }
      return { ok: true, request: { type, requestId, patch: patch as import("./dashboardProtocol").DashboardSettingsPatch } };
    }

    case "settings.reset":
      return { ok: true, request: { type, requestId } };

    default:
      return { ok: false, reason: `unknown message type: ${String(type)}` };
  }
};
