import { readFileSync } from "node:fs";

import { describe, expect, test, vi } from "vitest";

import { collectDepartmentSnapshot } from "./collect-department-snapshot.js";
import {
  fetchDepartmentPage,
  fetchDepartmentSections,
} from "./fetch-department-page.js";

const html = readFileSync(
  new URL("./fixtures/cmsc-202608-department.html", import.meta.url),
  "utf8",
);

describe("collectDepartmentSnapshot", () => {
  test("collects normalized metadata and bulk sections in memory", async () => {
    const fetchPage = vi.fn<typeof fetchDepartmentPage>().mockResolvedValue({
      html,
      finalUrl: "https://app.testudo.umd.edu/soc/202608/CMSC",
      status: 200,
      fetchedAt: "2026-08-26T06:58:11.000Z",
    });
    const fetchSections = vi
      .fn<typeof fetchDepartmentSections>()
      .mockResolvedValue({
        html: html.replaceAll('class="course"', 'class="course-sections"'),
        finalUrl:
          "https://app.testudo.umd.edu/soc/202608/sections?courseIds=CMSC131&courseIds=CMSC132",
        status: 200,
        fetchedAt: "2026-08-26T06:58:11.500Z",
      });

    const snapshot = await collectDepartmentSnapshot(
      { semester: "202608", department: "cmsc" },
      {
        fetchPage,
        fetchSections,
        now: () => new Date("2026-08-26T06:58:12.345Z"),
      },
    );

    expect(fetchPage).toHaveBeenCalledWith({
      semester: "202608",
      department: "CMSC",
    });
    expect(fetchSections).toHaveBeenCalledWith({
      semester: "202608",
      courseIds: ["CMSC131", "CMSC132"],
    });
    expect(snapshot).toMatchObject({
      semester: "202608",
      department: "CMSC",
      collectedAt: "2026-08-26T06:58:12.345Z",
      status: "complete",
      summary: {
        coursesFound: 2,
        coursesParsed: 2,
        coursesFailed: 0,
      },
    });
  });

  test("does not request sections when no courses are discovered", async () => {
    const fetchPage = vi.fn<typeof fetchDepartmentPage>().mockResolvedValue({
      html: "<html></html>",
      finalUrl: "https://app.testudo.umd.edu/soc/202608/CMSC",
      status: 200,
      fetchedAt: "2026-08-26T06:58:11.000Z",
    });
    const fetchSections = vi.fn<typeof fetchDepartmentSections>();

    await expect(
      collectDepartmentSnapshot(
        { semester: "202608", department: "CMSC" },
        { fetchPage, fetchSections },
      ),
    ).rejects.toMatchObject({ code: "NO_COURSES_FOUND" });
    expect(fetchSections).not.toHaveBeenCalled();
  });
});
