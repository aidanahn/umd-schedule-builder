import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { fetchDepartmentPage } from "./fetch-department-page.js";
import { ingestDepartment } from "./ingest-department.js";
import { writeDepartmentSnapshot } from "./write-snapshot.js";

const html = readFileSync(
  new URL("./fixtures/cmsc-202608-department.html", import.meta.url),
  "utf8",
);

describe("ingestDepartment", () => {
  it("fetches once, builds the snapshot, and writes it", async () => {
    const fetchPage = vi.fn<typeof fetchDepartmentPage>().mockResolvedValue({
      html,
      finalUrl: "https://app.testudo.umd.edu/soc/202608/CMSC",
      status: 200,
      fetchedAt: "2026-08-26T06:58:11.000Z",
    });
    const writeSnapshot = vi
      .fn<typeof writeDepartmentSnapshot>()
      .mockResolvedValue("/snapshots/result.json");

    const result = await ingestDepartment(
      { semester: "202608", department: "cmsc" },
      {
        fetchPage,
        writeSnapshot,
        now: () => new Date("2026-08-26T06:58:12.345Z"),
        outputRoot: "/snapshots",
      },
    );

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith({
      semester: "202608",
      department: "CMSC",
    });
    expect(writeSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        department: "CMSC",
        collectedAt: "2026-08-26T06:58:12.345Z",
        summary: expect.objectContaining({ coursesParsed: 2 }),
      }),
      { outputRoot: "/snapshots" },
    );
    expect(result.path).toBe("/snapshots/result.json");
    expect(result.snapshot.courses).toHaveLength(2);
  });

  it("does not write when snapshot construction fails", async () => {
    const fetchPage = vi.fn<typeof fetchDepartmentPage>().mockResolvedValue({
      html: "<html></html>",
      finalUrl: "https://app.testudo.umd.edu/soc/202608/CMSC",
      status: 200,
      fetchedAt: "2026-08-26T06:58:11.000Z",
    });
    const writeSnapshot = vi.fn<typeof writeDepartmentSnapshot>();

    await expect(
      ingestDepartment(
        { semester: "202608", department: "CMSC" },
        { fetchPage, writeSnapshot },
      ),
    ).rejects.toMatchObject({ code: "NO_COURSES_FOUND" });
    expect(writeSnapshot).not.toHaveBeenCalled();
  });
});
