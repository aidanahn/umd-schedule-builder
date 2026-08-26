# Testudo JSON Snapshot Ingestion Design

## Goal

Fetch one Testudo department page and turn all usable course and section data into a timestamped, normalized JSON snapshot. The first production target is Fall 2026 CMSC (`202608`, `CMSC`), while the command remains reusable for other semesters and departments.

This milestone connects the existing department-page fetcher and course parser into a complete ingestion run. It deliberately uses local JSON instead of a database so the full dataset can be inspected and stabilized before PostgreSQL becomes the source of seat history.

## Command-Line Interface

The scraper runs through the package script:

```bash
npm run scrape -- --semester 202608 --department CMSC
```

Both arguments are required. The semester must contain exactly six decimal digits in UMD's `YYYYMM` format. The department is uppercased before validation and must contain four ASCII letters.

On success, the command prints the snapshot path and a concise count of parsed courses and sections. Invalid arguments, a department fetch failure, zero successfully parsed courses, or any individual course failure produces a nonzero exit status. A partial run still reports its written snapshot path so it can be inspected.

## Data Flow

One ingestion run proceeds in this order:

1. Validate and normalize the semester and department arguments.
2. Fetch the Testudo department page once with the existing fetcher.
3. Load the HTML with Cheerio and locate every top-level `.course` container in display order.
4. Serialize each course container and pass it independently to `parseCoursePage` with the shared semester and department URL.
5. Collect valid courses, parser warnings, sanitized failures, and summary counts.
6. Refuse to write a snapshot if no courses parsed successfully.
7. Write the snapshot to a temporary file in its destination directory, then atomically rename it to the final timestamped path.

The department page already nests section rows under each course. Serializing the whole course container preserves its `.section` elements, including instructors, availability counts, meetings, rooms, delivery mode, and section-specific notes. The browser's Show/Hide Sections control only changes presentation and does not require extra HTTP requests.

The scraper will not make one request per course and will not retry individual course pages in this milestone. That keeps runs fast, minimizes traffic to Testudo, and reuses the existing parser without introducing a second ingestion path.

## Snapshot Location and Naming

Snapshots are written beneath:

```text
data/snapshots/<semester>/<department>/<timestamp>.json
```

For example:

```text
data/snapshots/202608/CMSC/2026-08-26T06-58-12-345Z.json
```

The filename is an ISO UTC timestamp with colon and period characters replaced by hyphens. Every successful or partial run receives a new file; existing snapshots are never overwritten. The generated `data/snapshots/` tree is gitignored.

The coordinator accepts an injectable clock and output root. Production uses the current time and `data/snapshots`; tests use a fixed time and temporary directory so filenames and filesystem behavior are deterministic.

## Snapshot Schema

The top-level document has this shape:

```ts
type SnapshotStatus = "complete" | "partial";

type SnapshotWarning = ParseWarning & {
  courseId: string;
};

type SnapshotFailure = {
  courseId: string | null;
  code: string;
  message: string;
};

type DepartmentSnapshot = {
  schemaVersion: 1;
  semester: string;
  department: string;
  collectedAt: string;
  sourceUrl: string;
  status: SnapshotStatus;
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
```

Courses remain in Testudo display order. Warnings retain parser warning fields and add their course ID so consumers do not need to infer ownership. Failures use stable codes where available and never contain raw HTML, stack traces, temporary file paths, or other unbounded diagnostic data.

`coursesFound` is the number of top-level course containers discovered in the department HTML. `coursesParsed` is the number included in `courses`, `coursesFailed` is the number omitted after a parse failure, and `sectionsParsed` is the sum of all returned section arrays. Skipped malformed sections remain represented through warnings rather than increasing `coursesFailed`.

The status is `complete` when every discovered course parses. It is `partial` when at least one course fails but at least one succeeds.

## Components and Boundaries

The ingestion coordinator owns fetching, course-container discovery, aggregation, and failure policy. It receives dependencies for fetching, time, and snapshot writing so its behavior can be exercised offline.

The snapshot writer owns directory creation, deterministic JSON serialization, temporary-file cleanup, and atomic rename. It does not know how Testudo works.

The CLI owns argument parsing, user-facing output, and mapping coordinator results or errors to process exit codes. It contains no HTML selectors or parsing rules.

The existing `fetchDepartmentPage` and `parseCoursePage` functions remain focused on HTTP retrieval and one-course parsing respectively. The parser model stays the canonical representation stored in snapshots.

## Failure Behavior

Course parsing is isolated per `.course` container. One fatal `TestudoParseError` becomes a `SnapshotFailure`, while later courses continue parsing. If the course ID cannot be recovered from the container, `courseId` is `null`.

Unexpected per-course exceptions are also sanitized into a generic stable failure code and concise message. The coordinator does not expose full source HTML or stack traces in the snapshot.

A partial snapshot is written after all course containers have been attempted, then the CLI exits nonzero. This preserves evidence for debugging while ensuring a scheduler cannot mistake incomplete ingestion for a healthy run.

The following failures write no final snapshot:

- invalid CLI input;
- failure to fetch or validate the department page;
- no course containers found;
- zero successfully parsed courses;
- failure during final snapshot writing or atomic rename.

Temporary files use a unique suffix in the destination directory. If writing or renaming fails, the writer attempts to remove its own temporary file before rethrowing the original error.

## Testing

Default tests remain offline and cover:

- required CLI arguments, department normalization, and invalid inputs;
- multiple course containers with nested section rows;
- preservation of course display order;
- aggregation of sections and parser warnings;
- one malformed course beside valid courses;
- refusal to write when no course succeeds;
- complete and partial status calculation;
- timestamped path generation with a fixed clock;
- atomic writing and cleanup after a simulated write failure;
- CLI output and exit-code mapping through direct function tests.

A checked-in, trimmed department fixture contains multiple CMSC courses and representative sections. It is small enough to understand and maintain, while retaining the nesting needed to protect course discovery.

An opt-in live integration test runs the coordinator for `202608` and `CMSC`, writes into a temporary directory, and verifies that the resulting snapshot contains multiple courses and sections. The test removes its temporary output when finished. Existing live fetcher and parser checks remain available.

## File Structure

Expected additions and focused changes:

```text
src/testudo/
  ingest-department.ts
  ingest-department.test.ts
  ingest-department.integration.test.ts
  write-snapshot.ts
  write-snapshot.test.ts
  fixtures/
    cmsc-202608-department.html
src/cli/
  scrape.ts
  scrape.test.ts
data/snapshots/                 # generated and gitignored
package.json                    # scrape script and live-test coverage
.gitignore                      # generated snapshots
```

Names may be consolidated during planning if a file would contain only trivial forwarding code, but the coordinator, writer, and CLI responsibilities remain separate.

## Deferred Work

This milestone does not add PostgreSQL, scheduled jobs, snapshot comparison, seat-change detection, notifications, user accounts, or the website. It also does not interpret prerequisite or restriction text.

When PostgreSQL is introduced, the coordinator's normalized `DepartmentSnapshot` provides the ingestion boundary. Seat observations can then be stored as historical rows instead of retaining timestamped JSON files indefinitely.

## Acceptance Criteria

- `npm run scrape -- --semester 202608 --department CMSC` fetches the department once and includes nested course sections in the output.
- Each run writes a new atomic snapshot beneath the approved semester and department path.
- The snapshot follows schema version 1 and contains collection metadata, normalized courses, warnings, failures, and accurate summary counts.
- One malformed course does not discard valid sibling courses; the partial snapshot is written and the CLI exits nonzero.
- Fetch failure, no discovered courses, or zero parsed courses produces no final snapshot.
- Generated snapshots are excluded from git.
- Default typechecking and tests make no network requests.
- The opt-in `202608` CMSC integration test parses multiple live courses and sections into a temporary snapshot.
