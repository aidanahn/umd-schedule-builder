import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { DepartmentSnapshot } from "./build-department-snapshot.js";
import { ingestDepartment } from "./ingest-department.js";

const runLiveTests = process.env.RUN_LIVE_TESTS === "true";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe.skipIf(!runLiveTests)("department ingestion integration", () => {
  it(
    "writes multiple Fall 2026 CMSC courses and sections",
    async () => {
      const outputRoot = await mkdtemp(join(tmpdir(), "umd-snapshot-"));
      temporaryDirectories.push(outputRoot);

      const result = await ingestDepartment(
        { semester: "202608", department: "CMSC" },
        { outputRoot },
      );
      const written = JSON.parse(
        await readFile(result.path, "utf8"),
      ) as DepartmentSnapshot;

      expect(written.department).toBe("CMSC");
      expect(written.status).toBe("complete");
      expect(written.courses.length).toBeGreaterThan(1);
      expect(written.summary.sectionsParsed).toBeGreaterThan(1);
      expect(written.courses.some((course) => course.sections.length > 0)).toBe(
        true,
      );
    },
    30_000,
  );
});
