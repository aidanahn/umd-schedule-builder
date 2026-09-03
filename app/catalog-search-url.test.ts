import { describe, expect, it } from "vitest";

import { buildCatalogSearchUrl } from "./catalog-search-url.js";

describe("buildCatalogSearchUrl", () => {
  it.each([
    [{ query: "CMSC 216&" }, "/?query=CMSC+216%26"],
    [
      { query: "calculus", department: "MATH" },
      "/?query=calculus&department=MATH",
    ],
    [{ query: "", department: "MATH" }, "/?department=MATH"],
    [{ query: "" }, "/"],
  ])("builds %#", (input, expected) => {
    expect(buildCatalogSearchUrl(input)).toBe(expected);
  });
});
