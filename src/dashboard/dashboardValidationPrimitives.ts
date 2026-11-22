export const isString = (v: unknown): v is string => typeof v === "string";
export const isNonEmptyString = (v: unknown): v is string => isString(v) && v.trim().length > 0;
export const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const isPositiveInt = (v: unknown): v is number => isNumber(v) && Number.isSafeInteger(v) && (v as number) > 0;
export const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";
export const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
