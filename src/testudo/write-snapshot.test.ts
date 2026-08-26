import { describe, expect, it, vi } from "vitest";

import type { DepartmentSnapshot } from "./build-department-snapshot.js";
import { writeDepartmentSnapshot } from "./write-snapshot.js";

const snapshot = {
  schemaVersion: 1,
  semester: "202608",
  department: "CMSC",
  collectedAt: "2026-08-26T06:58:12.345Z",
  sourceUrl: "https://app.testudo.umd.edu/soc/202608/CMSC",
  status: "complete",
  summary: {
    coursesFound: 2,
    coursesParsed: 2,
    coursesFailed: 0,
    sectionsParsed: 2,
  },
  courses: [],
  warnings: [],
  failures: [],
} satisfies DepartmentSnapshot;

function fileOperations() {
  return {
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
    link: vi.fn(async () => undefined),
    rm: vi.fn(async () => undefined),
  };
}

describe("writeDepartmentSnapshot", () => {
  it("publishes pretty JSON at a timestamped path without overwriting", async () => {
    const operations = fileOperations();

    const path = await writeDepartmentSnapshot(snapshot, {
      outputRoot: "/snapshots",
      temporarySuffix: "test-run",
      fileOperations: operations,
    });

    expect(path).toBe(
      "/snapshots/202608/CMSC/2026-08-26T06-58-12-345Z.json",
    );
    expect(operations.mkdir).toHaveBeenCalledWith(
      "/snapshots/202608/CMSC",
      { recursive: true },
    );
    expect(operations.writeFile).toHaveBeenCalledWith(
      `${path}.test-run.tmp`,
      `${JSON.stringify(snapshot, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    expect(operations.link).toHaveBeenCalledWith(
      `${path}.test-run.tmp`,
      path,
    );
    expect(operations.rm).toHaveBeenCalledWith(`${path}.test-run.tmp`, {
      force: true,
    });
  });

  it("cleans up its temporary file when exclusive publication fails", async () => {
    const operations = fileOperations();
    operations.link.mockRejectedValueOnce(
      Object.assign(new Error("snapshot already exists"), { code: "EEXIST" }),
    );

    await expect(
      writeDepartmentSnapshot(snapshot, {
        outputRoot: "/snapshots",
        temporarySuffix: "test-run",
        fileOperations: operations,
      }),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(operations.rm).toHaveBeenCalledWith(
      "/snapshots/202608/CMSC/2026-08-26T06-58-12-345Z.json.test-run.tmp",
      { force: true },
    );
  });
});
