import { describe, expect, it, vi } from "vitest";

import type { AppDatabase } from "../db/connection.js";
import type { DepartmentCatalogFailure } from "../ingestion/ingest-department-catalog.js";
import type { TestudoDepartment } from "../testudo/discover-semester-departments.js";
import {
  parseIngestAllArgs,
  runAllDepartmentIngestion,
} from "./ingest-all.js";

const departments: TestudoDepartment[] = [
  {
    code: "CMSC",
    name: "Computer Science",
    url: "https://app.testudo.umd.edu/soc/202608/CMSC",
  },
];

function dependencies() {
  const db = {} as AppDatabase;
  const close = vi.fn(async () => undefined);
  const discover = vi.fn(async () => departments);
  const connect = vi.fn(() => ({ db, close }));
  const ingest = vi.fn(async () => ({
    discovered: 1,
    attempted: 1,
    succeeded: 1,
    failed: 0,
    coursesParsed: 10,
    sectionsParsed: 20,
    observationsInserted: 20,
    eventsInserted: 2,
    failures: [] as DepartmentCatalogFailure[],
    aborted: false,
  }));
  return {
    db,
    close,
    discover,
    connect,
    ingest,
    stdout: vi.fn(),
    stderr: vi.fn(),
    signal: new AbortController().signal,
  };
}

describe("parseIngestAllArgs", () => {
  it("uses the default inter-department delay", () => {
    expect(parseIngestAllArgs(["--semester", "202608"])).toEqual({
      semester: "202608",
      departmentDelayMs: 5_000,
    });
  });

  it("accepts a zero-second delay", () => {
    expect(
      parseIngestAllArgs([
        "--semester",
        "202608",
        "--department-delay-seconds",
        "0",
      ]),
    ).toEqual({ semester: "202608", departmentDelayMs: 0 });
  });

  it.each([
    [[], "--semester is required"],
    [["--semester", "202701"], "only semester 202608 is supported"],
    [
      ["--semester", "202608", "--department-delay-seconds", "1.5"],
      "department delay must be a nonnegative whole number",
    ],
  ])("rejects invalid arguments %#", (argv, message) => {
    expect(() => parseIngestAllArgs(argv)).toThrow(message);
  });
});

describe("runAllDepartmentIngestion", () => {
  it("discovers before connecting and uses one shared connection", async () => {
    const options = dependencies();
    const order: string[] = [];
    options.discover.mockImplementation(async () => {
      order.push("discover");
      return departments;
    });
    options.connect.mockImplementation(() => {
      order.push("connect");
      return { db: options.db, close: options.close };
    });

    await expect(
      runAllDepartmentIngestion(["--semester", "202608"], options),
    ).resolves.toBe(0);

    expect(order).toEqual(["discover", "connect"]);
    expect(options.ingest).toHaveBeenCalledWith(
      options.db,
      {
        semester: "202608",
        departments,
        departmentDelayMs: 5_000,
        signal: options.signal,
      },
      expect.objectContaining({ stdout: options.stdout, stderr: options.stderr }),
    );
    expect(options.close).toHaveBeenCalledOnce();
  });

  it("returns one and closes when any department fails", async () => {
    const options = dependencies();
    options.ingest.mockResolvedValue({
      discovered: 1,
      attempted: 1,
      succeeded: 0,
      failed: 1,
      coursesParsed: 0,
      sectionsParsed: 0,
      observationsInserted: 0,
      eventsInserted: 0,
      failures: [
        {
          department: "CMSC",
          stage: "collection" as const,
          code: "COLLECTION_FAILED",
          message: "Department collection failed",
        },
      ],
      aborted: false,
    });

    await expect(
      runAllDepartmentIngestion(["--semester", "202608"], options),
    ).resolves.toBe(1);
    expect(options.close).toHaveBeenCalledOnce();
    expect(options.stderr).toHaveBeenCalledWith(
      "CMSC [collection/COLLECTION_FAILED]: Department collection failed",
    );
  });

  it("does not connect when discovery fails and sanitizes unknown errors", async () => {
    const options = dependencies();
    options.discover.mockRejectedValue(new Error("secret"));

    await expect(
      runAllDepartmentIngestion(["--semester", "202608"], options),
    ).resolves.toBe(1);
    expect(options.connect).not.toHaveBeenCalled();
    expect(options.stderr).toHaveBeenCalledWith("Department discovery failed");
  });
});
