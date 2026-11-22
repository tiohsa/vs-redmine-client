export const DEFAULT_DETAIL_HEIGHT_PERCENT = 48;
export const MIN_DETAIL_PANEL_HEIGHT_PX = 120;
export const MIN_TICKET_LIST_HEIGHT_PX = 100;
export const DETAIL_RESIZE_HANDLE_HEIGHT_PX = 6;
export const DETAIL_RESIZE_KEYBOARD_STEP_PERCENT = 5;

export interface DetailHeightBounds {
  readonly percent: number;
  readonly minPercent: number;
  readonly maxPercent: number;
}

export interface DetailResizeAriaValues {
  readonly valueMin: number;
  readonly valueMax: number;
  readonly valueNow: number;
}

export function normalizeDetailHeightPercent(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value < 100
    ? value
    : DEFAULT_DETAIL_HEIGHT_PERCENT;
}

export function clampDetailHeightPercent(
  requestedPercent: number,
  containerHeightPx: number,
  handleHeightPx: number = DETAIL_RESIZE_HANDLE_HEIGHT_PX,
): DetailHeightBounds {
  const safeHandlePx = typeof handleHeightPx === "number" && Number.isFinite(handleHeightPx) && handleHeightPx >= 0
    ? handleHeightPx
    : DETAIL_RESIZE_HANDLE_HEIGHT_PX;
  const safeRequested = typeof requestedPercent === "number" && Number.isFinite(requestedPercent)
    ? requestedPercent
    : DEFAULT_DETAIL_HEIGHT_PERCENT;
  if (typeof containerHeightPx !== "number" || !Number.isFinite(containerHeightPx) || containerHeightPx <= 0) {
    const fallback = normalizeDetailHeightPercent(safeRequested);
    return { percent: fallback, minPercent: 1, maxPercent: 99 };
  }
  const rawMin = (MIN_DETAIL_PANEL_HEIGHT_PX / containerHeightPx) * 100;
  const rawMax = ((containerHeightPx - MIN_TICKET_LIST_HEIGHT_PX - safeHandlePx) / containerHeightPx) * 100;
  if (rawMin > rawMax) {
    const availablePx = Math.max(0, containerHeightPx - safeHandlePx);
    const ratio = MIN_DETAIL_PANEL_HEIGHT_PX / (MIN_DETAIL_PANEL_HEIGHT_PX + MIN_TICKET_LIST_HEIGHT_PX);
    const fallback = Math.round(((availablePx * ratio) / containerHeightPx) * 10000) / 100;
    return { percent: fallback, minPercent: fallback, maxPercent: fallback };
  }
  const ceiledMin = Math.ceil(rawMin * 100) / 100;
  const flooredMax = Math.floor(rawMax * 100) / 100;
  const minPercent = ceiledMin <= flooredMax ? ceiledMin : rawMin;
  const maxPercent = ceiledMin <= flooredMax ? flooredMax : rawMax;
  const clamped = Math.min(Math.max(safeRequested, minPercent), maxPercent);
  const rounded = Math.round(clamped * 100) / 100;
  const percent = Math.min(Math.max(rounded, minPercent), maxPercent);
  return { percent, minPercent, maxPercent };
}

export function computeDetailResizeAriaValues(bounds: DetailHeightBounds): DetailResizeAriaValues {
  const rawMin = Math.ceil(bounds.minPercent);
  const rawMax = Math.floor(bounds.maxPercent);
  const valueMin = rawMin <= rawMax ? rawMin : Math.round(bounds.minPercent);
  const valueMax = rawMin <= rawMax ? rawMax : Math.round(bounds.maxPercent);
  const valueNow = Math.min(Math.max(Math.round(bounds.percent), valueMin), valueMax);
  return { valueMin, valueMax, valueNow };
}
