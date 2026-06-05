import type { DashboardRequest, DashboardUnsyncedKey } from "./dashboardProtocol";
import { EDITOR_DEFAULT_FIELDS } from "../config/settings";

type ValidationResult =
  | { ok: true; request: DashboardRequest }
  | { ok: false; reason: string };

const isString = (v: unknown): v is string => typeof v === "string";
const isNonEmptyString = (v: unknown): v is string => isString(v) && v.trim().length > 0;
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isPositiveInt = (v: unknown): v is number => isNumber(v) && Number.isInteger(v) && (v as number) > 0;
const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";
const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((item) => typeof item === "string");
const isPositiveIntArray = (v: unknown): v is number[] =>
  Array.isArray(v) && v.every((item) => isPositiveInt(item));

const UNSYNCED_KINDS = new Set(["ticket", "newTicket", "comment"]);
const OFFLINE_SYNC_MODES = new Set(["auto", "manual"]);
const SORT_DIRECTIONS = new Set(["asc", "desc"]);
const SORT_FIELDS = new Set(["priority", "status", "tracker", "assignee"]);
const METADATA_PATCH_FIELDS = new Set(["tracker", "priority", "status", "due_date", "start_date", "assignee"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const validateUnsyncedKey = (v: unknown): v is DashboardUnsyncedKey => {
  if (!isObject(v)) { return false; }
  const kind = v["kind"];
  if (!isString(kind) || !UNSYNCED_KINDS.has(kind)) { return false; }
  if (kind === "ticket" && !isPositiveInt(v["ticketId"])) { return false; }
  if (kind === "newTicket" && "documentUri" in v && !isNonEmptyString(v["documentUri"])) { return false; }
  if (kind === "comment") {
    if (!isPositiveInt(v["ticketId"])) { return false; }
    if ("commentId" in v && !isPositiveInt(v["commentId"])) { return false; }
    if ("documentUri" in v && !isNonEmptyString(v["documentUri"])) { return false; }
    if (!("commentId" in v) && !("documentUri" in v)) { return false; }
  }
  return true;
};

const validateSettingsPatch = (v: unknown): boolean => {
  if (!isObject(v)) { return false; }
  if ("filters" in v) {
    const f = v["filters"];
    if (!isObject(f)) { return false; }
    if ("subjectQuery" in f && !isString(f["subjectQuery"])) { return false; }
    if ("priorityIds" in f && !isPositiveIntArray(f["priorityIds"])) { return false; }
    if ("statusIds" in f && !isPositiveIntArray(f["statusIds"])) { return false; }
    if ("trackerIds" in f && !isPositiveIntArray(f["trackerIds"])) { return false; }
    if ("assigneeIds" in f && !isPositiveIntArray(f["assigneeIds"])) { return false; }
    if ("includeUnassigned" in f && !isBoolean(f["includeUnassigned"])) { return false; }
  }
  if ("sort" in v) {
    const s = v["sort"];
    if (!isObject(s)) { return false; }
    if ("direction" in s && !SORT_DIRECTIONS.has(s["direction"] as string)) { return false; }
    if ("field" in s && s["field"] !== undefined && !SORT_FIELDS.has(s["field"] as string)) { return false; }
  }
  if ("dueDate" in v) {
    const d = v["dueDate"];
    if (!isObject(d)) { return false; }
    for (const key of ["showWithin7Days", "showWithin3Days", "showWithin1Day", "showOverdue"]) {
      if (key in d && !isBoolean(d[key])) { return false; }
    }
  }
  return true;
};

const validateGeneralPatch = (v: unknown): boolean => {
  if (!isObject(v)) { return false; }
  if ("offlineSyncMode" in v && !OFFLINE_SYNC_MODES.has(v["offlineSyncMode"] as string)) { return false; }
  if ("includeChildProjects" in v && !isBoolean(v["includeChildProjects"])) { return false; }
  if ("ticketListLimit" in v) {
    const limit = v["ticketListLimit"];
    if (!isNumber(limit) || !Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 500) {
      return false;
    }
  }
  return true;
};

const validateMetadataPatch = (v: unknown): boolean => {
  if (!isObject(v)) { return false; }
  const keys = Object.keys(v);
  if (keys.length === 0) { return false; }
  if (keys.some((key) => !METADATA_PATCH_FIELDS.has(key))) { return false; }
  for (const key of ["tracker", "priority", "status"]) {
    if (key in v && !isNonEmptyString(v[key])) { return false; }
  }
  if ("due_date" in v) {
    const dueDate = v["due_date"];
    if (!isString(dueDate)) { return false; }
    if (dueDate.length > 0 && !DATE_RE.test(dueDate)) { return false; }
  }
  if ("start_date" in v) {
    const startDate = v["start_date"];
    if (!isString(startDate)) { return false; }
    if (startDate.length > 0 && !DATE_RE.test(startDate)) { return false; }
  }
  if ("assignee" in v && !isString(v["assignee"])) { return false; }
  return true;
};

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
      if (!isPositiveInt(projectId)) {
        return { ok: false, reason: "project.select: projectId must be a positive integer" };
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
      return { ok: true, request: { type, requestId } };

    case "tickets.searchAllProjects": {
      const query = raw["query"];
      if (!isString(query)) {
        return { ok: false, reason: "tickets.searchAllProjects: query must be a string" };
      }
      return { ok: true, request: { type, requestId, query } };
    }

    case "tickets.loadMore":
      return { ok: true, request: { type, requestId } };

    case "ticket.select": {
      const ticketId = raw["ticketId"];
      if (!isPositiveInt(ticketId)) {
        return { ok: false, reason: "ticket.select: ticketId must be a positive integer" };
      }
      return { ok: true, request: { type, requestId, ticketId } };
    }

    case "ticket.openEditor": {
      const ticketId = raw["ticketId"];
      if (!isPositiveInt(ticketId)) {
        return { ok: false, reason: "ticket.openEditor: ticketId must be a positive integer" };
      }
      return { ok: true, request: { type, requestId, ticketId } };
    }

    case "ticket.openBrowser": {
      const ticketId = raw["ticketId"];
      if (!isPositiveInt(ticketId)) {
        return { ok: false, reason: "ticket.openBrowser: ticketId must be a positive integer" };
      }
      return { ok: true, request: { type, requestId, ticketId } };
    }

    case "ticket.create":
      return { ok: true, request: { type, requestId } };

    case "ticket.createChild": {
      const parentTicketId = raw["parentTicketId"];
      if (!isPositiveInt(parentTicketId)) {
        return { ok: false, reason: "ticket.createChild: parentTicketId must be a positive integer" };
      }
      return { ok: true, request: { type, requestId, parentTicketId } };
    }

    case "ticket.cancelDetail":
    case "ticket.cancelComposer":
      return { ok: true, request: { type, requestId } };

    case "ticket.syncNewTicketDraftFromComposer":
      return { ok: true, request: { type, requestId } };

    case "ticket.createDraftFromComposer": {
      const values = raw["values"];
      if (!isObject(values)) {
        return { ok: false, reason: "ticket.createDraftFromComposer: values must be an object" };
      }
      if (!isNonEmptyString(values["tracker"])) {
        return { ok: false, reason: "ticket.createDraftFromComposer: values.tracker must be a non-empty string" };
      }
      if (!isNonEmptyString(values["priority"])) {
        return { ok: false, reason: "ticket.createDraftFromComposer: values.priority must be a non-empty string" };
      }
      if ("status" in values && values["status"] !== undefined && values["status"] !== "" && !isString(values["status"])) {
        return { ok: false, reason: "ticket.createDraftFromComposer: values.status must be a string" };
      }
      if ("start_date" in values && values["start_date"] !== undefined && values["start_date"] !== "") {
        if (!isString(values["start_date"]) || !DATE_RE.test(values["start_date"] as string)) {
          return { ok: false, reason: "ticket.createDraftFromComposer: values.start_date must be YYYY-MM-DD or empty" };
        }
      }
      if ("due_date" in values && values["due_date"] !== undefined && values["due_date"] !== "") {
        if (!isString(values["due_date"]) || !DATE_RE.test(values["due_date"] as string)) {
          return { ok: false, reason: "ticket.createDraftFromComposer: values.due_date must be YYYY-MM-DD or empty" };
        }
      }
      if ("assigned_to" in values && values["assigned_to"] !== undefined && !isString(values["assigned_to"])) {
        return { ok: false, reason: "ticket.createDraftFromComposer: values.assigned_to must be a string" };
      }
      return {
        ok: true,
        request: {
          type,
          requestId,
          values: {
            tracker: values["tracker"] as string,
            priority: values["priority"] as string,
            status: (values["status"] as string | undefined) ?? "",
            assigned_to: (values["assigned_to"] as string | undefined) ?? undefined,
            start_date: (values["start_date"] as string | undefined) ?? undefined,
            due_date: (values["due_date"] as string | undefined) ?? undefined,
            description: (values["description"] as string | undefined) ?? undefined,
          },
        },
      };
    }

    case "ticket.metadata.update": {
      const ticketId = raw["ticketId"];
      if (!isPositiveInt(ticketId)) {
        return { ok: false, reason: "ticket.metadata.update: ticketId must be a positive integer" };
      }
      const patch = raw["patch"];
      if (!validateMetadataPatch(patch)) {
        return { ok: false, reason: "ticket.metadata.update: patch is invalid" };
      }
      return { ok: true, request: { type, requestId, ticketId, patch: patch as import("./dashboardProtocol").TicketMetadataPatch } };
    }

    case "ticket.syncSelected": {
      const ticketId = raw["ticketId"];
      if (!isPositiveInt(ticketId)) {
        return { ok: false, reason: "ticket.syncSelected: ticketId must be a positive integer" };
      }
      return { ok: true, request: { type, requestId, ticketId } };
    }

    case "comment.add": {
      const ticketId = raw["ticketId"];
      if (!isPositiveInt(ticketId)) {
        return { ok: false, reason: "comment.add: ticketId must be a positive integer" };
      }
      return { ok: true, request: { type, requestId, ticketId } };
    }

    case "comment.edit": {
      const ticketId = raw["ticketId"];
      const commentId = raw["commentId"];
      if (!isPositiveInt(ticketId)) {
        return { ok: false, reason: "comment.edit: ticketId must be a positive integer" };
      }
      if (!isPositiveInt(commentId)) {
        return { ok: false, reason: "comment.edit: commentId must be a positive integer" };
      }
      return { ok: true, request: { type, requestId, ticketId, commentId } };
    }

    case "comment.openBrowser": {
      const ticketId = raw["ticketId"];
      const commentId = raw["commentId"];
      if (!isPositiveInt(ticketId)) {
        return { ok: false, reason: "comment.openBrowser: ticketId must be a positive integer" };
      }
      if (!isPositiveInt(commentId)) {
        return { ok: false, reason: "comment.openBrowser: commentId must be a positive integer" };
      }
      const noteIndex = raw["noteIndex"];
      return { ok: true, request: { type, requestId, ticketId, commentId, noteIndex: isPositiveInt(noteIndex) ? noteIndex : undefined } };
    }

    case "comment.reload": {
      const ticketId = raw["ticketId"];
      if (!isPositiveInt(ticketId)) {
        return { ok: false, reason: "comment.reload: ticketId must be a positive integer" };
      }
      return { ok: true, request: { type, requestId, ticketId } };
    }

    case "unsynced.openLocalFile": {
      const documentUri = raw["documentUri"];
      if (!isNonEmptyString(documentUri)) {
        return { ok: false, reason: "unsynced.openLocalFile: documentUri must be a non-empty string" };
      }
      return { ok: true, request: { type, requestId, documentUri } };
    }

    case "unsynced.syncOne":
    case "unsynced.discardOne": {
      const key = raw["key"];
      if (!validateUnsyncedKey(key)) {
        return { ok: false, reason: `${type}: key is invalid` };
      }
      return { ok: true, request: { type, requestId, key } };
    }

    case "unsynced.syncAll":
      return { ok: true, request: { type, requestId } };

    case "settings.update": {
      const patch = raw["patch"];
      if (!validateSettingsPatch(patch)) {
        return { ok: false, reason: "settings.update: patch is invalid" };
      }
      return { ok: true, request: { type, requestId, patch: patch as import("./dashboardProtocol").DashboardSettingsPatch } };
    }

    case "settings.reset":
      return { ok: true, request: { type, requestId } };

    case "settings.updateEditorDefault": {
      const field = raw["field"];
      const value = raw["value"];
      if (!isString(field) || !(EDITOR_DEFAULT_FIELDS as readonly string[]).includes(field)) {
        return { ok: false, reason: `settings.updateEditorDefault: field must be one of ${EDITOR_DEFAULT_FIELDS.join(", ")}` };
      }
      if (!isString(value)) {
        return { ok: false, reason: "settings.updateEditorDefault: value must be a string" };
      }
      return { ok: true, request: { type, requestId, field, value } };
    }

    case "settings.resetEditorDefaults": {
      const fields = raw["fields"];
      if (!isStringArray(fields)) {
        return { ok: false, reason: "settings.resetEditorDefaults: fields must be an array of strings" };
      }
      const validFields = (EDITOR_DEFAULT_FIELDS as readonly string[]);
      const invalid = fields.find((f) => !validFields.includes(f));
      if (invalid !== undefined) {
        return { ok: false, reason: `settings.resetEditorDefaults: unknown field "${invalid}"` };
      }
      return { ok: true, request: { type, requestId, fields } };
    }

    case "settings.updateGeneral": {
      const patch = raw["patch"];
      if (!validateGeneralPatch(patch)) {
        return { ok: false, reason: "settings.updateGeneral: patch is invalid" };
      }
      return { ok: true, request: { type, requestId, patch: patch as import("./dashboardProtocol").DashboardGeneralSettingsPatch } };
    }

    case "apiKey.set":
    case "apiKey.clear":
      return { ok: true, request: { type, requestId } };

    default:
      return { ok: false, reason: `unknown message type: ${String(type)}` };
  }
};
