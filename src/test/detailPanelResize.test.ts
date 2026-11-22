import * as assert from "assert";
import {
  DEFAULT_DETAIL_HEIGHT_PERCENT,
  DETAIL_RESIZE_HANDLE_HEIGHT_PX,
  MIN_DETAIL_PANEL_HEIGHT_PX,
  MIN_TICKET_LIST_HEIGHT_PX,
  clampDetailHeightPercent,
  computeDetailResizeAriaValues,
  normalizeDetailHeightPercent,
} from "../dashboard/detailPanelResize";

suite("Detail panel vertical resize calculations", () => {
  test("normalizeDetailHeightPercent accepts finite open-interval percentages and falls back on invalid inputs", () => {
    assert.strictEqual(normalizeDetailHeightPercent(48), 48);
    assert.strictEqual(normalizeDetailHeightPercent(25.5), 25.5);
    assert.strictEqual(normalizeDetailHeightPercent(0.25), 0.25);
    assert.strictEqual(normalizeDetailHeightPercent(99.75), 99.75);

    for (const invalid of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -5, 100, 150, "48", "bad", {}]) {
      assert.strictEqual(
        normalizeDetailHeightPercent(invalid),
        DEFAULT_DETAIL_HEIGHT_PERCENT,
        `expected default for ${String(invalid)}`,
      );
    }
  });

  test("clampDetailHeightPercent enforces minimum detail (120px) and ticket list (100px) heights", () => {
    const containerHeight = 600;
    const mid = clampDetailHeightPercent(48, containerHeight);
    assert.deepStrictEqual(mid, { percent: 48, minPercent: 20, maxPercent: 82.33 });

    const tooSmall = clampDetailHeightPercent(5, containerHeight);
    assert.strictEqual(tooSmall.percent, 20);
    assert.ok((tooSmall.percent / 100) * containerHeight >= MIN_DETAIL_PANEL_HEIGHT_PX);

    const negative = clampDetailHeightPercent(-30, containerHeight);
    assert.strictEqual(negative.percent, 20);

    const tooLarge = clampDetailHeightPercent(98, containerHeight);
    assert.strictEqual(tooLarge.percent, 82.33);
    const remainingListPx = containerHeight - (tooLarge.percent / 100) * containerHeight - DETAIL_RESIZE_HANDLE_HEIGHT_PX;
    assert.ok(remainingListPx >= MIN_TICKET_LIST_HEIGHT_PX);

    const overflowRequest = clampDetailHeightPercent(150, containerHeight);
    assert.strictEqual(overflowRequest.percent, 82.33);
  });

  test("clampDetailHeightPercent rounds bounds inward so non-divisible containers still satisfy pixel minimums", () => {
    const containerHeight = 573;
    const low = clampDetailHeightPercent(1, containerHeight, 6);
    const high = clampDetailHeightPercent(99, containerHeight, 6);

    assert.ok((low.minPercent / 100) * containerHeight >= MIN_DETAIL_PANEL_HEIGHT_PX);
    assert.ok(
      containerHeight - (high.maxPercent / 100) * containerHeight - 6 >= MIN_TICKET_LIST_HEIGHT_PX,
    );
    assert.strictEqual(low.percent, low.minPercent);
    assert.strictEqual(high.percent, high.maxPercent);
  });

  test("clampDetailHeightPercent falls back safely on non-finite request, invalid handle, or non-positive container", () => {
    const nanRequest = clampDetailHeightPercent(Number.NaN, 600);
    assert.strictEqual(nanRequest.percent, DEFAULT_DETAIL_HEIGHT_PERCENT);

    const invalidHandle = clampDetailHeightPercent(95, 600, -10);
    assert.strictEqual(invalidHandle.maxPercent, 82.33);

    const zeroContainer = clampDetailHeightPercent(62, 0);
    assert.deepStrictEqual(zeroContainer, { percent: 62, minPercent: 1, maxPercent: 99 });

    const negativeContainer = clampDetailHeightPercent(150, -200);
    assert.deepStrictEqual(negativeContainer, {
      percent: DEFAULT_DETAIL_HEIGHT_PERCENT,
      minPercent: 1,
      maxPercent: 99,
    });
  });

  test("clampDetailHeightPercent uses proportional fallback when container height is shorter than 226px", () => {
    const exactMinimum = clampDetailHeightPercent(48, 226, 6);
    assert.ok(exactMinimum.percent >= 53 && exactMinimum.percent <= 54);
    assert.strictEqual(exactMinimum.minPercent, exactMinimum.maxPercent);

    const shortContainer = clampDetailHeightPercent(90, 180, 6);
    assert.strictEqual(shortContainer.minPercent, shortContainer.maxPercent);
    assert.strictEqual(shortContainer.percent, shortContainer.minPercent);
    assert.strictEqual(shortContainer.percent, 52.73);
    const detailPx = (shortContainer.percent / 100) * 180;
    const listPx = 180 - 6 - detailPx;
    assert.ok(detailPx > 0 && listPx > 0);

    const tinyContainer = clampDetailHeightPercent(48, 6, 6);
    assert.deepStrictEqual(tinyContainer, { percent: 0, minPercent: 0, maxPercent: 0 });
  });

  test("computeDetailResizeAriaValues keeps valueMin <= valueNow <= valueMax across normal and collapsed bounds", () => {
    const normal = computeDetailResizeAriaValues({ percent: 48.4, minPercent: 20.01, maxPercent: 82.33 });
    assert.deepStrictEqual(normal, { valueMin: 21, valueMax: 82, valueNow: 48 });

    const clampedLow = computeDetailResizeAriaValues({ percent: 20.01, minPercent: 20.01, maxPercent: 82.33 });
    assert.deepStrictEqual(clampedLow, { valueMin: 21, valueMax: 82, valueNow: 21 });

    const collapsed = computeDetailResizeAriaValues({ percent: 52.73, minPercent: 52.73, maxPercent: 52.73 });
    assert.deepStrictEqual(collapsed, { valueMin: 53, valueMax: 53, valueNow: 53 });
  });
});
