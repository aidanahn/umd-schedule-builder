import { describe, expect, it, vi } from "vitest";

import {
  buildDepartmentUrl,
  fetchDepartmentPage,
  TestudoFetchError,
} from "./fetch-department-page.js";

describe("buildDepartmentUrl", () => {
  it("builds the Testudo URL and normalizes the department", () => {
    expect(
      buildDepartmentUrl({ semester: "202608", department: "cmsc" }),
    ).toBe("https://app.testudo.umd.edu/soc/202608/CMSC");
  });

  it.each([
    [{ semester: "20268", department: "CMSC" }, "semester"],
    [{ semester: "2026FA", department: "CMSC" }, "semester"],
    [{ semester: "202608", department: "CS" }, "department"],
    [{ semester: "202608", department: "CS1C" }, "department"],
  ])("rejects invalid input %#", (input, field) => {
    expect(() => buildDepartmentUrl(input)).toThrowError(TestudoFetchError);
    expect(() => buildDepartmentUrl(input)).toThrow(field);
  });

  it("rejects invalid input before calling fetch", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      fetchDepartmentPage(
        { semester: "fall-2026", department: "CMSC" },
        { fetchImpl },
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
