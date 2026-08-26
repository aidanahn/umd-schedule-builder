# Testudo JSON Snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a parameterized CLI that fetches one Testudo department page and writes all successfully parsed courses and nested sections to a timestamped JSON snapshot.

**Architecture:** A pure department-page builder discovers top-level course containers and aggregates the existing one-course parser results. A filesystem writer owns atomic timestamped output, an ingestion coordinator connects the existing fetcher to the builder and writer, and a thin CLI handles arguments, messages, and exit codes.

**Tech Stack:** Node.js 20+, TypeScript 5.9, Cheerio 1.2, Vitest 3.2, tsx

**Spec:** `docs/superpowers/specs/2026-08-26-testudo-json-snapshot-design.md`

## Global Constraints

- Fetch the Testudo department page exactly once per ingestion run.
- Require a six-digit semester and a four-letter department; uppercase the department.
- Preserve Testudo course display order and all nested sections returned by `parseCoursePage`.
- Write a partial snapshot and return a failing CLI exit code when at least one course fails.
- Write no final snapshot when fetching fails, no course containers exist, or zero courses parse.
- Never include raw HTML, stack traces, or temporary paths in snapshot failures.
- Write snapshots beneath `data/snapshots/<semester>/<department>/<UTC timestamp>.json` without overwriting older runs.
- Use a temporary file in the destination directory and an atomic rename for final output.
- Keep default tests offline; live tests remain opt-in through `npm run test:live`.
- Do not add PostgreSQL, scheduled jobs, comparisons, notifications, accounts, or website code in this milestone.

## File Map

- Create `src/testudo/build-department-snapshot.ts`: snapshot types, top-level course discovery, independent parsing, warning/failure aggregation, and zero-success errors.
- Create `src/testudo/build-department-snapshot.test.ts`: offline aggregation tests using a trimmed department fixture and focused malformed markup.
- Create `src/testudo/fixtures/cmsc-202608-department.html`: two realistic CMSC course containers with nested sections.
- Create `src/testudo/write-snapshot.ts`: timestamped path creation, pretty JSON encoding, temporary write, atomic rename, and owned-temp cleanup.
- Create `src/testudo/write-snapshot.test.ts`: deterministic writer tests with injected file operations.
- Create `src/testudo/ingest-department.ts`: one-fetch orchestration and injected clock/writer dependencies.
- Create `src/testudo/ingest-department.test.ts`: offline coordinator tests proving a single fetch and correct write behavior.
- Create `src/testudo/ingest-department.integration.test.ts`: opt-in live `202608` CMSC ingestion into a temporary directory.
- Create `src/cli/scrape.ts`: CLI argument parsing, human-readable reporting, and process exit mapping.
- Create `src/cli/scrape.test.ts`: direct CLI-function tests without child processes or network access.
- Modify `package.json`: add `tsx` and the `scrape` script.
- Modify `package-lock.json`: lock `tsx` and its transitive dependencies.
- Modify `.gitignore`: ignore generated `data/snapshots/` files.

---

### Task 1: Build a Department Snapshot in Memory

**Files:**
- Create: `src/testudo/build-department-snapshot.ts`
- Create: `src/testudo/build-department-snapshot.test.ts`
- Create: `src/testudo/fixtures/cmsc-202608-department.html`

**Interfaces:**
- Consumes: `parseCoursePage({ html, semester, sourceUrl })` from `src/testudo/parse-course-page.ts`.
- Produces: `buildDepartmentSnapshot(input): DepartmentSnapshot`, the snapshot model types, and `DepartmentSnapshotError`.

- [ ] **Step 1: Add a trimmed multi-course department fixture**

Create `src/testudo/fixtures/cmsc-202608-department.html` with two sibling course containers. Keep the markup small but retain the exact nesting used by the existing parser:

```html
<!doctype html>
<html lang="en">
  <body>
    <div id="CMSC131" class="course">
      <span class="course-id">CMSC131</span>
      <span class="course-title">Object-Oriented Programming I</span>
      <span class="course-min-credits">4</span>
      <div class="sections-container">
        <div class="section delivery-f2f">
          <span class="section-id">0101</span>
          <span class="section-instructor">Elias Gonzalez</span>
          <span class="total-seats-count">32</span>
          <span class="open-seats-count">2</span>
          <span class="waitlist-count">0</span>
          <div class="class-days-container">
            <div class="row">
              <span class="section-days">MWF</span>
              <span class="class-start-time">10:00am</span>
              <span class="class-end-time">10:50am</span>
              <span class="building-code">IRB</span>
              <span class="class-room">0324</span>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div id="CMSC132" class="course">
      <span class="course-id">CMSC132</span>
      <span class="course-title">Object-Oriented Programming II</span>
      <span class="course-min-credits">4</span>
      <div class="sections-container">
        <div class="section delivery-f2f">
          <span class="section-id">0201</span>
          <span class="section-instructor">Example Instructor</span>
          <span class="total-seats-count">28</span>
          <span class="open-seats-count">5</span>
          <div class="class-days-container">
            <div class="row">
              <span class="section-days">TuTh</span>
              <span class="class-start-time">2:00pm</span>
              <span class="class-end-time">3:15pm</span>
              <span class="building-code">IRB</span>
              <span class="class-room">1207</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </body>
</html>
```

- [ ] **Step 2: Write failing aggregation and isolation tests**

Create `src/testudo/build-department-snapshot.test.ts`. Read the fixture from `./fixtures/cmsc-202608-department.html` relative to `import.meta.url`, then cover the public behavior:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  buildDepartmentSnapshot,
  DepartmentSnapshotError,
} from "./build-department-snapshot.js";

const fixture = readFileSync(
  new URL("./fixtures/cmsc-202608-department.html", import.meta.url),
  "utf8",
);

const input = {
  html: fixture,
  semester: "202608",
  department: "CMSC",
  collectedAt: "2026-08-26T06:58:12.345Z",
  sourceUrl: "https://app.testudo.umd.edu/soc/202608/CMSC",
};

describe("buildDepartmentSnapshot", () => {
  it("parses courses and their nested sections in display order", () => {
    const snapshot = buildDepartmentSnapshot(input);

    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      semester: "202608",
      department: "CMSC",
      collectedAt: "2026-08-26T06:58:12.345Z",
      status: "complete",
      summary: {
        coursesFound: 2,
        coursesParsed: 2,
        coursesFailed: 0,
        sectionsParsed: 2,
      },
    });
    expect(snapshot.courses.map((course) => course.id)).toEqual([
      "CMSC131",
      "CMSC132",
    ]);
    expect(snapshot.courses[0]?.sections[0]?.id).toBe("CMSC131-0101");
  });

  it("records a malformed course and keeps valid siblings", () => {
    const html = fixture.replace(
      '<span class="course-title">Object-Oriented Programming II</span>',
      "",
    );
    const snapshot = buildDepartmentSnapshot({ ...input, html });

    expect(snapshot.status).toBe("partial");
    expect(snapshot.courses.map((course) => course.id)).toEqual(["CMSC131"]);
    expect(snapshot.summary).toMatchObject({
      coursesFound: 2,
      coursesParsed: 1,
      coursesFailed: 1,
      sectionsParsed: 1,
    });
    expect(snapshot.failures).toEqual([
      {
        courseId: "CMSC132",
        code: "COURSE_TITLE_MISSING",
        message: "course title is missing",
      },
    ]);
  });

  it("associates section warnings with their course", () => {
    const html = fixture.replace(
      '<span class="total-seats-count">32</span>',
      '<span class="total-seats-count">unknown</span>',
    );
    const snapshot = buildDepartmentSnapshot({ ...input, html });

    expect(snapshot.warnings).toContainEqual(
      expect.objectContaining({
        courseId: "CMSC131",
        code: "SECTION_SKIPPED",
        field: "section.seats.total",
      }),
    );
  });

  it.each([
    ["<html></html>", "NO_COURSES_FOUND"],
    [
      fixture.replace(/<span class="course-title">[^<]+<\/span>/g, ""),
      "NO_COURSES_PARSED",
    ],
  ])("rejects unusable department HTML with %s", (html, code) => {
    expect(() => buildDepartmentSnapshot({ ...input, html })).toThrowError(
      expect.objectContaining({ code }),
    );
    expect(() => buildDepartmentSnapshot({ ...input, html })).toThrowError(
      DepartmentSnapshotError,
    );
  });
});
```

- [ ] **Step 3: Run the focused test and verify red**

Run: `npm test -- src/testudo/build-department-snapshot.test.ts`

Expected: FAIL because `build-department-snapshot.ts` does not exist.

- [ ] **Step 4: Define the snapshot contract and errors**

Create `src/testudo/build-department-snapshot.ts` with these exported types:

```ts
import { load } from "cheerio";

import {
  parseCoursePage,
  TestudoParseError,
  type Course,
  type ParseWarning,
} from "./parse-course-page.js";

export type SnapshotWarning = ParseWarning & { courseId: string };
export type SnapshotFailure = {
  courseId: string | null;
  code: string;
  message: string;
};
export type DepartmentSnapshot = {
  schemaVersion: 1;
  semester: string;
  department: string;
  collectedAt: string;
  sourceUrl: string;
  status: "complete" | "partial";
  summary: {
    coursesFound: number;
    coursesParsed: number;
    coursesFailed: number;
    sectionsParsed: number;
  };
  courses: Course[];
  warnings: SnapshotWarning[];
  failures: SnapshotFailure[];
};
export type BuildDepartmentSnapshotInput = {
  html: string;
  semester: string;
  department: string;
  collectedAt: string;
  sourceUrl: string;
};
export type DepartmentSnapshotErrorCode =
  | "NO_COURSES_FOUND"
  | "NO_COURSES_PARSED";

export class DepartmentSnapshotError extends Error {
  constructor(
    public readonly code: DepartmentSnapshotErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DepartmentSnapshotError";
  }
}
```

- [ ] **Step 5: Implement top-level discovery and independent parsing**

Implement `buildDepartmentSnapshot` with top-level filtering so nested or duplicated `.course` markup is not counted twice:

```ts
function visibleCourseId(text: string): string | null {
  const id = text.replace(/\s+/g, "").toUpperCase();
  return /^[A-Z]{4}\d{3}[A-Z]?$/.test(id) ? id : null;
}

export function buildDepartmentSnapshot(
  input: BuildDepartmentSnapshotInput,
): DepartmentSnapshot {
  const $ = load(input.html);
  const courseNodes = $(".course")
    .filter((_index, element) => $(element).parents(".course").length === 0)
    .toArray();

  if (courseNodes.length === 0) {
    throw new DepartmentSnapshotError(
      "NO_COURSES_FOUND",
      "Testudo department page did not contain course containers",
    );
  }

  const courses: Course[] = [];
  const warnings: SnapshotWarning[] = [];
  const failures: SnapshotFailure[] = [];

  for (const element of courseNodes) {
    const container = $(element);
    const courseId = visibleCourseId(container.find(".course-id").first().text());

    try {
      const result = parseCoursePage({
        html: $.html(element),
        semester: input.semester,
        sourceUrl: input.sourceUrl,
      });
      courses.push(result.course);
      warnings.push(
        ...result.warnings.map((warning) => ({
          ...warning,
          courseId: result.course.id,
        })),
      );
    } catch (error) {
      failures.push(
        error instanceof TestudoParseError
          ? { courseId, code: error.code, message: error.message }
          : {
              courseId,
              code: "UNEXPECTED_PARSE_ERROR",
              message: "Course parser failed unexpectedly",
            },
      );
    }
  }

  if (courses.length === 0) {
    throw new DepartmentSnapshotError(
      "NO_COURSES_PARSED",
      "No Testudo courses could be parsed",
    );
  }

  return {
    schemaVersion: 1,
    semester: input.semester,
    department: input.department,
    collectedAt: input.collectedAt,
    sourceUrl: input.sourceUrl,
    status: failures.length === 0 ? "complete" : "partial",
    summary: {
      coursesFound: courseNodes.length,
      coursesParsed: courses.length,
      coursesFailed: failures.length,
      sectionsParsed: courses.reduce(
        (count, course) => count + course.sections.length,
        0,
      ),
    },
    courses,
    warnings,
    failures,
  };
}
```

- [ ] **Step 6: Run focused and existing parser tests**

Run: `npm test -- src/testudo/build-department-snapshot.test.ts src/testudo/parse-course-page.test.ts && npm run typecheck`

Expected: both test files PASS and typechecking exits 0.

- [ ] **Step 7: Commit the in-memory snapshot builder**

```bash
git add src/testudo/build-department-snapshot.ts src/testudo/build-department-snapshot.test.ts src/testudo/fixtures/cmsc-202608-department.html
git commit -m "Build department snapshots in memory"
```

---

### Task 2: Write Timestamped Snapshots Atomically

**Files:**
- Create: `src/testudo/write-snapshot.ts`
- Create: `src/testudo/write-snapshot.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `DepartmentSnapshot` from `build-department-snapshot.ts`.
- Produces: `writeDepartmentSnapshot(snapshot, options?): Promise<string>` returning the final path.

- [ ] **Step 1: Write failing path, atomic-write, and cleanup tests**

Create `src/testudo/write-snapshot.test.ts` with injected operations so it never touches production data:

```ts
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
    coursesFound: 0,
    coursesParsed: 0,
    coursesFailed: 0,
    sectionsParsed: 0,
  },
  courses: [],
  warnings: [],
  failures: [],
} satisfies DepartmentSnapshot;

function operations() {
  return {
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    rm: vi.fn(async () => undefined),
  };
}

describe("writeDepartmentSnapshot", () => {
  it("writes pretty JSON to a temporary file before atomic rename", async () => {
    const fileOperations = operations();
    const path = await writeDepartmentSnapshot(snapshot, {
      outputRoot: "/snapshots",
      temporarySuffix: "test-run",
      fileOperations,
    });

    expect(path).toBe(
      "/snapshots/202608/CMSC/2026-08-26T06-58-12-345Z.json",
    );
    expect(fileOperations.mkdir).toHaveBeenCalledWith(
      "/snapshots/202608/CMSC",
      { recursive: true },
    );
    expect(fileOperations.writeFile).toHaveBeenCalledWith(
      `${path}.test-run.tmp`,
      `${JSON.stringify(snapshot, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    expect(fileOperations.rename).toHaveBeenCalledWith(
      `${path}.test-run.tmp`,
      path,
    );
    expect(fileOperations.rm).not.toHaveBeenCalled();
  });

  it("removes its temporary file when rename fails", async () => {
    const fileOperations = operations();
    fileOperations.rename.mockRejectedValueOnce(new Error("rename failed"));

    await expect(
      writeDepartmentSnapshot(snapshot, {
        outputRoot: "/snapshots",
        temporarySuffix: "test-run",
        fileOperations,
      }),
    ).rejects.toThrow("rename failed");
    expect(fileOperations.rm).toHaveBeenCalledWith(
      "/snapshots/202608/CMSC/2026-08-26T06-58-12-345Z.json.test-run.tmp",
      { force: true },
    );
  });
});
```

- [ ] **Step 2: Run the writer test and verify red**

Run: `npm test -- src/testudo/write-snapshot.test.ts`

Expected: FAIL because `write-snapshot.ts` does not exist.

- [ ] **Step 3: Implement the atomic writer**

Create `src/testudo/write-snapshot.ts`:

```ts
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { DepartmentSnapshot } from "./build-department-snapshot.js";

export type SnapshotFileOperations = {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  writeFile(
    path: string,
    data: string,
    options: { encoding: "utf8"; flag: "wx" },
  ): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  rm(path: string, options: { force: true }): Promise<void>;
};

export type WriteDepartmentSnapshotOptions = {
  outputRoot?: string;
  temporarySuffix?: string;
  fileOperations?: SnapshotFileOperations;
};

const defaultOperations: SnapshotFileOperations = {
  mkdir,
  writeFile,
  rename,
  rm,
};

function timestampFilename(collectedAt: string): string {
  return `${collectedAt.replace(/[:.]/g, "-")}.json`;
}

export async function writeDepartmentSnapshot(
  snapshot: DepartmentSnapshot,
  options: WriteDepartmentSnapshotOptions = {},
): Promise<string> {
  const outputRoot = options.outputRoot ?? "data/snapshots";
  const temporarySuffix = options.temporarySuffix ?? randomUUID();
  const fileOperations = options.fileOperations ?? defaultOperations;
  const directory = join(outputRoot, snapshot.semester, snapshot.department);
  const finalPath = join(directory, timestampFilename(snapshot.collectedAt));
  const temporaryPath = `${finalPath}.${temporarySuffix}.tmp`;

  await fileOperations.mkdir(directory, { recursive: true });

  try {
    await fileOperations.writeFile(
      temporaryPath,
      `${JSON.stringify(snapshot, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    await fileOperations.rename(temporaryPath, finalPath);
  } catch (error) {
    await fileOperations.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }

  return finalPath;
}
```

- [ ] **Step 4: Ignore generated snapshots**

Append this entry to `.gitignore`:

```gitignore
data/snapshots/
```

- [ ] **Step 5: Run writer tests and typechecking**

Run: `npm test -- src/testudo/write-snapshot.test.ts && npm run typecheck`

Expected: writer tests PASS and typechecking exits 0.

- [ ] **Step 6: Commit the atomic writer**

```bash
git add .gitignore src/testudo/write-snapshot.ts src/testudo/write-snapshot.test.ts
git commit -m "Write timestamped snapshots atomically"
```

---

### Task 3: Coordinate Fetching, Parsing, and Writing

**Files:**
- Create: `src/testudo/ingest-department.ts`
- Create: `src/testudo/ingest-department.test.ts`

**Interfaces:**
- Consumes: `fetchDepartmentPage`, `buildDepartmentSnapshot`, and `writeDepartmentSnapshot`.
- Produces: `ingestDepartment(input, options?): Promise<IngestDepartmentResult>`.

- [ ] **Step 1: Write failing coordinator tests**

Create `src/testudo/ingest-department.test.ts` using the checked-in department fixture:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { ingestDepartment } from "./ingest-department.js";

const html = readFileSync(
  new URL("./fixtures/cmsc-202608-department.html", import.meta.url),
  "utf8",
);

describe("ingestDepartment", () => {
  it("fetches once, builds the snapshot, and writes it", async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      html,
      finalUrl: "https://app.testudo.umd.edu/soc/202608/CMSC",
      status: 200,
      fetchedAt: "2026-08-26T06:58:11.000Z",
    });
    const writeSnapshot = vi.fn().mockResolvedValue("/snapshots/result.json");

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

  it("does not call the writer when snapshot construction fails", async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      html: "<html></html>",
      finalUrl: "https://app.testudo.umd.edu/soc/202608/CMSC",
      status: 200,
      fetchedAt: "2026-08-26T06:58:11.000Z",
    });
    const writeSnapshot = vi.fn();

    await expect(
      ingestDepartment(
        { semester: "202608", department: "CMSC" },
        { fetchPage, writeSnapshot },
      ),
    ).rejects.toMatchObject({ code: "NO_COURSES_FOUND" });
    expect(writeSnapshot).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the coordinator test and verify red**

Run: `npm test -- src/testudo/ingest-department.test.ts`

Expected: FAIL because `ingest-department.ts` does not exist.

- [ ] **Step 3: Implement the coordinator with injected dependencies**

Create `src/testudo/ingest-department.ts`:

```ts
import {
  buildDepartmentSnapshot,
  type DepartmentSnapshot,
} from "./build-department-snapshot.js";
import { fetchDepartmentPage } from "./fetch-department-page.js";
import {
  writeDepartmentSnapshot,
  type WriteDepartmentSnapshotOptions,
} from "./write-snapshot.js";

export type IngestDepartmentInput = {
  semester: string;
  department: string;
};
export type IngestDepartmentResult = {
  snapshot: DepartmentSnapshot;
  path: string;
};
export type IngestDepartmentOptions = {
  fetchPage?: typeof fetchDepartmentPage;
  writeSnapshot?: typeof writeDepartmentSnapshot;
  now?: () => Date;
  outputRoot?: string;
};

export async function ingestDepartment(
  input: IngestDepartmentInput,
  options: IngestDepartmentOptions = {},
): Promise<IngestDepartmentResult> {
  const department = input.department.toUpperCase();
  const normalizedInput = { semester: input.semester, department };
  const fetched = await (options.fetchPage ?? fetchDepartmentPage)(
    normalizedInput,
  );
  const snapshot = buildDepartmentSnapshot({
    ...normalizedInput,
    html: fetched.html,
    collectedAt: (options.now ?? (() => new Date()))().toISOString(),
    sourceUrl: fetched.finalUrl,
  });
  const writeOptions: WriteDepartmentSnapshotOptions = options.outputRoot
    ? { outputRoot: options.outputRoot }
    : {};
  const path = await (options.writeSnapshot ?? writeDepartmentSnapshot)(
    snapshot,
    writeOptions,
  );

  return { snapshot, path };
}
```

- [ ] **Step 4: Run coordinator, builder, writer, and fetcher tests**

Run: `npm test -- src/testudo/ingest-department.test.ts src/testudo/build-department-snapshot.test.ts src/testudo/write-snapshot.test.ts src/testudo/fetch-department-page.test.ts && npm run typecheck`

Expected: all named test files PASS and typechecking exits 0.

- [ ] **Step 5: Commit the ingestion coordinator**

```bash
git add src/testudo/ingest-department.ts src/testudo/ingest-department.test.ts
git commit -m "Coordinate department ingestion"
```

---

### Task 4: Add the Scrape CLI and Live Acceptance Test

**Files:**
- Create: `src/cli/scrape.ts`
- Create: `src/cli/scrape.test.ts`
- Create: `src/testudo/ingest-department.integration.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `ingestDepartment(input, options?)` from Task 3.
- Produces: `parseScrapeArgs(argv)`, `runScrape(argv, options?): Promise<number>`, and the parameterized `npm run scrape` command demonstrated with `--semester 202608 --department CMSC`.

- [ ] **Step 1: Install the TypeScript command runner**

Run: `npm install --save-dev tsx@^4.20.0`

Expected: `tsx` appears in `devDependencies`, the lockfile updates, and npm reports zero known vulnerabilities.

- [ ] **Step 2: Write failing CLI tests**

Create `src/cli/scrape.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { parseScrapeArgs, runScrape } from "./scrape.js";

describe("parseScrapeArgs", () => {
  it("normalizes valid arguments", () => {
    expect(
      parseScrapeArgs(["--semester", "202608", "--department", "cmsc"]),
    ).toEqual({ semester: "202608", department: "CMSC" });
  });

  it.each([
    [[], "--semester is required"],
    [["--semester", "202608"], "--department is required"],
    [
      ["--semester", "fall", "--department", "CMSC"],
      "semester must contain exactly six digits",
    ],
    [
      ["--semester", "202608", "--department", "CS"],
      "department must contain exactly four ASCII letters",
    ],
  ])("rejects invalid arguments %#", (argv, message) => {
    expect(() => parseScrapeArgs(argv)).toThrow(message);
  });
});

describe("runScrape", () => {
  it("prints the path and summary for a complete snapshot", async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const ingest = vi.fn().mockResolvedValue({
      path: "data/snapshots/202608/CMSC/result.json",
      snapshot: {
        status: "complete",
        summary: { coursesParsed: 2, sectionsParsed: 3 },
      },
    });

    await expect(
      runScrape(["--semester", "202608", "--department", "CMSC"], {
        ingest,
        stdout,
        stderr,
      }),
    ).resolves.toBe(0);
    expect(stdout).toHaveBeenCalledWith(
      "Wrote data/snapshots/202608/CMSC/result.json (2 courses, 3 sections)",
    );
    expect(stderr).not.toHaveBeenCalled();
  });

  it("writes a partial result message and returns one", async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const ingest = vi.fn().mockResolvedValue({
      path: "data/snapshots/202608/CMSC/partial.json",
      snapshot: {
        status: "partial",
        summary: {
          coursesParsed: 1,
          coursesFailed: 1,
          sectionsParsed: 2,
        },
      },
    });

    await expect(
      runScrape(["--semester", "202608", "--department", "CMSC"], {
        ingest,
        stdout,
        stderr,
      }),
    ).resolves.toBe(1);
    expect(stdout).toHaveBeenCalledWith(
      "Wrote data/snapshots/202608/CMSC/partial.json (1 course, 2 sections)",
    );
    expect(stderr).toHaveBeenCalledWith("Snapshot is partial: 1 course failed");
  });

  it("returns two for invalid arguments without ingesting", async () => {
    const ingest = vi.fn();
    const stderr = vi.fn();

    await expect(runScrape([], { ingest, stderr })).resolves.toBe(2);
    expect(ingest).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith("--semester is required");
  });
});
```

- [ ] **Step 3: Run the CLI test and verify red**

Run: `npm test -- src/cli/scrape.test.ts`

Expected: FAIL because `src/cli/scrape.ts` does not exist.

- [ ] **Step 4: Implement argument parsing and exit-code mapping**

Create `src/cli/scrape.ts` with a directly testable runner. Use `parseArgs` from `node:util`, `pathToFileURL` from `node:url`, and `ingestDepartment`:

```ts
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { ingestDepartment } from "../testudo/ingest-department.js";

export type ScrapeCliOptions = {
  ingest?: typeof ingestDepartment;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
};

export function parseScrapeArgs(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      semester: { type: "string" },
      department: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });

  if (!values.semester) throw new Error("--semester is required");
  if (!values.department) throw new Error("--department is required");
  if (!/^\d{6}$/.test(values.semester)) {
    throw new Error("semester must contain exactly six digits");
  }
  if (!/^[A-Za-z]{4}$/.test(values.department)) {
    throw new Error("department must contain exactly four ASCII letters");
  }

  return {
    semester: values.semester,
    department: values.department.toUpperCase(),
  };
}

function countLabel(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

export async function runScrape(
  argv: string[],
  options: ScrapeCliOptions = {},
): Promise<number> {
  const stdout = options.stdout ?? console.log;
  const stderr = options.stderr ?? console.error;
  let input: ReturnType<typeof parseScrapeArgs>;

  try {
    input = parseScrapeArgs(argv);
  } catch (error) {
    stderr(error instanceof Error ? error.message : "Invalid arguments");
    return 2;
  }

  try {
    const result = await (options.ingest ?? ingestDepartment)(input);
    const summary = result.snapshot.summary;
    stdout(
      `Wrote ${result.path} (${countLabel(summary.coursesParsed, "course")}, ${countLabel(summary.sectionsParsed, "section")})`,
    );

    if (result.snapshot.status === "partial") {
      stderr(
        `Snapshot is partial: ${countLabel(summary.coursesFailed, "course")} failed`,
      );
      return 1;
    }

    return 0;
  } catch (error) {
    stderr(error instanceof Error ? error.message : "Scrape failed");
    return 1;
  }
}

async function main(): Promise<void> {
  process.exitCode = await runScrape(process.argv.slice(2));
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  void main();
}
```

- [ ] **Step 5: Add the package script**

Add this script to `package.json`:

```json
"scrape": "tsx src/cli/scrape.ts"
```

- [ ] **Step 6: Run the CLI tests and full offline check**

Run: `npm test -- src/cli/scrape.test.ts && npm run check`

Expected: CLI tests PASS; typechecking and all offline tests exit 0.

- [ ] **Step 7: Add the opt-in live ingestion test**

Create `src/testudo/ingest-department.integration.test.ts`:

```ts
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
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })),
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
      expect(written.courses.length).toBeGreaterThan(1);
      expect(written.summary.sectionsParsed).toBeGreaterThan(1);
      expect(written.courses.some((course) => course.sections.length > 0)).toBe(
        true,
      );
    },
    30_000,
  );
});
```

- [ ] **Step 8: Run the live acceptance tests**

Run: `npm run test:live`

Expected: the existing fetcher/parser integrations and the new ingestion integration all PASS against Testudo `202608` CMSC.

- [ ] **Step 9: Exercise the real CLI once**

Run: `npm run scrape -- --semester 202608 --department CMSC`

Expected: exit 0 for a complete snapshot, print a timestamped path under `data/snapshots/202608/CMSC/`, and report nonzero course and section counts. If live Testudo contains an individually malformed course, expect a partial snapshot, exit 1, and inspect its `failures` before deciding whether the parser needs a separate follow-up.

- [ ] **Step 10: Inspect the generated snapshot without committing it**

Run: `git status --short && node -e 'const fs=require("node:fs"); const dir="data/snapshots/202608/CMSC"; const name=fs.readdirSync(dir).filter((value)=>value.endsWith(".json")).sort().at(-1); if(!name) throw new Error("snapshot not found"); const data=JSON.parse(fs.readFileSync(`${dir}/${name}`,"utf8")); console.log(data.summary, data.status)'`

Expected: the summary matches the CLI output, status is `complete` or an explained `partial`, and `git status` does not list the generated snapshot because `data/snapshots/` is ignored.

- [ ] **Step 11: Run final verification**

Run: `npm run check && npm run test:live && git diff --check`

Expected: typechecking, all offline tests, all live tests, and whitespace checks pass.

- [ ] **Step 12: Commit the CLI and live coverage**

```bash
git add package.json package-lock.json src/cli/scrape.ts src/cli/scrape.test.ts src/testudo/ingest-department.integration.test.ts
git commit -m "Add department snapshot CLI"
```
