import * as assert from "assert";
import { normalizeFilterOptions } from "../views/ticketsView";

suite("Ticket filter options", () => {
  test("returns full option list even when no matches", () => {
    const allOptions = ["Open", "Closed", "In Progress"];
    const matchingOptions: string[] = [];

    const result = normalizeFilterOptions(allOptions, matchingOptions);

    assert.deepStrictEqual(result, allOptions);
  });
});
