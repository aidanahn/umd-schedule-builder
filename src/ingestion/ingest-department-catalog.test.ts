import { describe, expect, it, vi } from "vitest";

import type { AppDatabase } from "../db/connection.js";
import type { DepartmentSnapshot } from "../testudo/build-department-snapshot.js";
import type { TestudoDepartment } from "../testudo/discover-semester-departments.js";
import { ingestDepartmentCatalog } from "./ingest-department-catalog.js";

const departments: TestudoDepartment[] = ["AAAS", "CMSC", "MATH"].map(
  (code) => ({
    code,
    name: code,
    url: `https://app.testudo.umd.edu/soc/202608/${code}`,
  }),
);

function snapshot(department: string, coursesParsed = 2): DepartmentSnapshot {
  return {
    schemaVersion: 1,
    semester: "202608",
    department,
    collectedAt: "2026-09-02T12:00:00.000Z",
    sourceUrl: `https://app.testudo.umd.edu/soc/202608/${department}`,
    status: "complete",
    summary: {
      coursesFound: coursesParsed,
      coursesParsed,
      coursesFailed: 0,
      sectionsParsed: department === "CMSC" ? 5 : 3,
    },
    courses: [],
    warnings: [],
    failures: [],
  };
}

function options(signal = new AbortController().signal) {
  return {
    semester: "202608",
    departments,
    departmentDelayMs: 5_000,
    signal,
  };
}

describe("ingestDepartmentCatalog", () => {
  it("collects and persists departments sequentially with aggregate totals", async () => {
    const trace: string[] = [];
    const collect = vi.fn(async ({ department }: { department: string }) => {
      trace.push(`collect:${department}`);
      return snapshot(department);
    });
    const persist = vi.fn(async (_db, value: DepartmentSnapshot) => {
      trace.push(`persist:${value.department}`);
      return {
        ingestionId: value.department,
        previousIngestionId: null,
        alreadyPersisted: false,
        observationsInserted: value.summary.sectionsParsed,
        eventsInserted: value.department === "CMSC" ? 4 : 0,
      };
    });
    const wait = vi.fn(async (delay: number) => {
      trace.push(`wait:${delay}`);
    });

    const summary = await ingestDepartmentCatalog({} as AppDatabase, options(), {
      collect,
      persist,
      wait,
    });

    expect(trace).toEqual([
      "collect:AAAS",
      "persist:AAAS",
      "wait:5000",
      "collect:CMSC",
      "persist:CMSC",
      "wait:5000",
      "collect:MATH",
      "persist:MATH",
    ]);
    expect(summary).toEqual({
      discovered: 3,
      attempted: 3,
      succeeded: 3,
      failed: 0,
      coursesParsed: 6,
      sectionsParsed: 11,
      observationsInserted: 11,
      eventsInserted: 4,
      failures: [],
      aborted: false,
    });
  });

  it("records a collection failure and continues", async () => {
    const collect = vi.fn(async ({ department }: { department: string }) => {
      if (department === "AAAS") throw new Error("secret");
      return snapshot(department);
    });
    const persist = vi.fn(async () => ({
      ingestionId: "id",
      previousIngestionId: null,
      alreadyPersisted: false,
      observationsInserted: 3,
      eventsInserted: 0,
    }));

    const summary = await ingestDepartmentCatalog({} as AppDatabase, options(), {
      collect,
      persist,
      wait: async () => undefined,
    });

    expect(summary.succeeded).toBe(2);
    expect(summary.failures).toEqual([
      {
        department: "AAAS",
        stage: "collection",
        code: "COLLECTION_FAILED",
        message: "Department collection failed",
      },
    ]);
    expect(JSON.stringify(summary)).not.toContain("secret");
  });

  it("does not trust a code property on an unexpected error", async () => {
    const codedError = Object.assign(new Error("password=secret"), {
      code: "ECONNRESET",
    });
    const summary = await ingestDepartmentCatalog(
      {} as AppDatabase,
      { ...options(), departments: departments.slice(0, 1) },
      { collect: async () => Promise.reject(codedError) },
    );

    expect(summary.failures[0]).toEqual({
      department: "AAAS",
      stage: "collection",
      code: "COLLECTION_FAILED",
      message: "Department collection failed",
    });
  });

  it("does not begin work when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const collect = vi.fn();

    const summary = await ingestDepartmentCatalog(
      {} as AppDatabase,
      options(controller.signal),
      { collect, wait: async () => undefined },
    );

    expect(collect).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ attempted: 0, aborted: true });
  });

  it("validates the delay before collection", async () => {
    await expect(
      ingestDepartmentCatalog(
        {} as AppDatabase,
        { ...options(), departmentDelayMs: -1 },
        { collect: vi.fn() },
      ),
    ).rejects.toThrow("departmentDelayMs must be a nonnegative safe integer");
  });
});
