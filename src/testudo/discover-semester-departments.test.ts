import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  buildSemesterUrl,
  discoverSemesterDepartments,
  parseSemesterDepartments,
  SemesterDiscoveryError,
} from "./discover-semester-departments.js";

const fixture = readFileSync(
  new URL("./fixtures/202608-departments.html", import.meta.url),
  "utf8",
);

describe("parseSemesterDepartments", () => {
  it("returns valid departments in source order and removes duplicates", () => {
    expect(
      parseSemesterDepartments({
        semester: "202608",
        html: fixture,
        sourceUrl: "https://app.testudo.umd.edu/soc/202608",
      }),
    ).toEqual([
      {
        code: "AAAS",
        name: "African American and Africana Studies",
        url: "https://app.testudo.umd.edu/soc/202608/AAAS",
      },
      {
        code: "CMSC",
        name: "Computer Science",
        url: "https://app.testudo.umd.edu/soc/202608/CMSC",
      },
      {
        code: "MATH",
        name: "Mathematics",
        url: "https://app.testudo.umd.edu/soc/202608/MATH",
      },
    ]);
  });

  it("rejects invalid semesters", () => {
    expect(() =>
      parseSemesterDepartments({
        semester: "fall",
        html: fixture,
        sourceUrl: "https://app.testudo.umd.edu/soc/202608",
      }),
    ).toThrowError(SemesterDiscoveryError);
  });

  it("rejects an index with no valid department links", () => {
    expect(() =>
      parseSemesterDepartments({
        semester: "202608",
        html: "<html><body>No departments</body></html>",
        sourceUrl: "https://app.testudo.umd.edu/soc/202608",
      }),
    ).toThrowError(expect.objectContaining({ code: "NO_DEPARTMENTS_FOUND" }));
  });
});

describe("discoverSemesterDepartments", () => {
  it("requests the official semester index and parses its departments", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(fixture, {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    const departments = await discoverSemesterDepartments(
      { semester: "202608" },
      { fetchImpl },
    );

    expect(buildSemesterUrl("202608")).toBe(
      "https://app.testudo.umd.edu/soc/202608",
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://app.testudo.umd.edu/soc/202608",
      expect.any(Object),
    );
    expect(departments.map(({ code }) => code)).toEqual([
      "AAAS",
      "CMSC",
      "MATH",
    ]);
  });
});
