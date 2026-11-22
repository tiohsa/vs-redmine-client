import { normalizeBaseUrl } from "../redmine/client";
import { isBoolean, isNumber, isObject, isPositiveInt, isString } from "./dashboardValidationPrimitives";

const isPositiveIntArray = (v: unknown): v is number[] =>
  Array.isArray(v) && v.every((item) => isPositiveInt(item));
const OFFLINE_SYNC_MODES = new Set(["auto", "manual"]);
const SORT_DIRECTIONS = new Set(["asc", "desc"]);
const SORT_FIELDS = new Set(["priority", "status", "tracker", "assignee", "dueDate", "startDate"]);
const SYNC_FILTERS = new Set(["all", "dirty", "editing", "unsynced"]);

export const validateSettingsPatch = (v: unknown): boolean => {
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
    if ("syncFilter" in f && !SYNC_FILTERS.has(f["syncFilter"] as string)) { return false; }
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

export const validateGeneralPatch = (v: unknown): boolean => {
  if (!isObject(v)) { return false; }
  if ("offlineSyncMode" in v && !OFFLINE_SYNC_MODES.has(v["offlineSyncMode"] as string)) { return false; }
  if ("includeChildProjects" in v && !isBoolean(v["includeChildProjects"])) { return false; }
  if ("showStatus" in v && !isBoolean(v["showStatus"])) { return false; }
  if ("showDueDate" in v && !isBoolean(v["showDueDate"])) { return false; }
  if ("showTracker" in v && !isBoolean(v["showTracker"])) { return false; }
  if ("showPriority" in v && !isBoolean(v["showPriority"])) { return false; }
  if ("showAssignee" in v && !isBoolean(v["showAssignee"])) { return false; }
  if ("followActiveEditor" in v && !isBoolean(v["followActiveEditor"])) { return false; }
  if ("ticketListLimit" in v) {
    const limit = v["ticketListLimit"];
    if (!isNumber(limit) || !Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 500) {
      return false;
    }
  }
  return true;
};

const isValidBaseUrl = (value: unknown): value is string => {
  if (!isString(value)) { return false; }
  const trimmed = value.trim();
  if (!trimmed) { return true; }
  try {
    normalizeBaseUrl(trimmed);
    return true;
  } catch {
    return false;
  }
};

export const validateConnectionPatch = (v: unknown): boolean => {
  if (!isObject(v)) { return false; }
  if ("baseUrl" in v && !isValidBaseUrl(v["baseUrl"])) { return false; }
  if ("defaultProjectId" in v && !isString(v["defaultProjectId"])) { return false; }
  if ("requestTimeoutMs" in v && (!isNumber(v["requestTimeoutMs"]) || (v["requestTimeoutMs"] as number) <= 0)) {
    return false;
  }
  if ("ignoreSSLErrors" in v && !isBoolean(v["ignoreSSLErrors"])) { return false; }
  return true;
};

export const validateEditorPatch = (v: unknown): boolean => {
  if (!isObject(v)) { return false; }
  return !("editorStorageDirectory" in v) || isString(v["editorStorageDirectory"]);
};

