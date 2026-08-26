import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import type { DepartmentSnapshot } from "../testudo/build-department-snapshot.js";
import { parseCompareArgs, runCompare } from "./compare-snapshots.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

function snapshot(collectedAt: string): DepartmentSnapshot {
  return {
    schemaVersion: 1,
    semester: "202608",
    department: "CMSC",
    collectedAt,
    sourceUrl: "https://app.testudo.umd.edu/soc/202608/CMSC",
    status: "complete",
    summary: {
      coursesFound: 0,
      coursesParsed: 0,
      coursesFailed: 0,
      sectionsParsed: 0,
    },
    courses: [],
    warnings: [],
    failures: [],
  };
}

async function writeSnapshotPair(
  before: DepartmentSnapshot = snapshot("2026-08-26T14:00:00.000Z"),
  after: DepartmentSnapshot = snapshot("2026-08-26T14:05:00.000Z"),
): Promise<{ beforePath: string; afterPath: string }> {
  const directory = await mkdtemp(join(tmpdir(), "snapshot-comparison-"));
  temporaryDirectories.push(directory);
  const beforePath = join(directory, "before.json");
  const afterPath = join(directory, "after.json");

  await Promise.all([
    writeFile(beforePath, JSON.stringify(before), "utf8"),
    writeFile(afterPath, JSON.stringify(after), "utf8"),
  ]);

  return { beforePath, afterPath };
}

describe("parseCompareArgs", () => {
  it("accepts both snapshot paths", () => {
    expect(
      parseCompareArgs([
        "--before",
        "data/before.json",
        "--after",
        "data/after.json",
      ]),
    ).toEqual({
      before: "data/before.json",
      after: "data/after.json",
    });
  });

  it.each([
    [[], "--before is required"],
    [["--before", "before.json"], "--after is required"],
  ])("rejects missing paths %#", (argv, message) => {
    expect(() => parseCompareArgs(argv)).toThrow(message);
  });
});

describe("runCompare", () => {
  it("reads two snapshots and prints the JSON report", async () => {
    const { beforePath, afterPath } = await writeSnapshotPair();
    const stdout: string[] = [];
    const stderr: string[] = [];

    await expect(
      runCompare(["--before", beforePath, "--after", afterPath], {
        stdout: (message) => stdout.push(message),
        stderr: (message) => stderr.push(message),
      }),
    ).resolves.toBe(0);

    expect(JSON.parse(stdout.join("\n"))).toMatchObject({
      schemaVersion: 1,
      semester: "202608",
      department: "CMSC",
      summary: { events: 0, sectionsChanged: 0 },
      events: [],
    });
    expect(stderr).toEqual([]);
  });

  it("returns two when required arguments are missing", async () => {
    const stderr: string[] = [];

    await expect(
      runCompare([], { stderr: (message) => stderr.push(message) }),
    ).resolves.toBe(2);
    expect(stderr).toEqual(["--before is required"]);
  });

  it("returns one when snapshots cannot be safely compared", async () => {
    const partial = snapshot("2026-08-26T14:00:00.000Z");
    partial.status = "partial";
    const { beforePath, afterPath } = await writeSnapshotPair(
      partial,
      snapshot("2026-08-26T14:05:00.000Z"),
    );
    const stderr: string[] = [];

    await expect(
      runCompare(["--before", beforePath, "--after", afterPath], {
        stderr: (message) => stderr.push(message),
      }),
    ).resolves.toBe(1);
    expect(stderr).toEqual(["both snapshots must be complete"]);
  });
});
