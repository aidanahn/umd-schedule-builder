# All-Departments Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discover every Fall 2026 Testudo department and ingest each one sequentially through a one-time command and a rediscovering recurring-worker mode.

**Architecture:** Extract the already-tested generic Testudo request behavior so a semester-index fetch uses exactly the same HTTP protections as department fetches. Parse discovery into a validated ordered list, feed it to a database-agnostic sequential coordinator, then expose that coordinator through a shared-connection CLI and a recurring cycle runner that invokes fresh discovery every cycle.

**Tech Stack:** Node.js 20+, TypeScript, Cheerio, Drizzle ORM, node-postgres, Vitest

**Spec:** `docs/superpowers/specs/2026-09-02-all-departments-catalog-design.md`

## Global Constraints

- Support only semester `202608` in the product rollout while keeping reusable six-digit semester validation in lower-level Testudo functions.
- Discover departments from the official semester index; do not hard-code or cache the list between worker cycles.
- Process departments sequentially with a default five-second delay and no concurrency.
- Keep one transaction per department and one PostgreSQL connection per complete batch/cycle.
- Continue after individual department failures; never persist partial snapshots.
- Preserve existing `scrape`, `ingest:db`, single-department worker, snapshot schema, observation, and seat-event behavior.
- Keep all credentials in `DATABASE_URL`; logs must not expose raw HTML, connection strings, or unexpected error contents.
- Use `--all-departments`, `INGEST_ALL_DEPARTMENTS=true`, `--department-delay-seconds`, and `INGEST_DEPARTMENT_DELAY_SECONDS` exactly as specified.
- The recurring worker must fetch and parse the semester index again at the start of every cycle.

---

### Task 1: Shared Testudo request and semester-index discovery

**Files:**
- Modify: `src/testudo/fetch-department-page.ts`
- Modify: `src/testudo/fetch-department-page.test.ts`
- Create: `src/testudo/discover-semester-departments.ts`
- Create: `src/testudo/discover-semester-departments.test.ts`
- Create: `src/testudo/fixtures/202608-departments.html`

**Interfaces:**
- Consumes: the existing `TestudoFetchError`, retry options, validation behavior, and injected `fetch` pattern.
- Produces: `fetchTestudoPage(url, options)`, `buildSemesterUrl(semester)`, `TestudoDepartment`, `parseSemesterDepartments(input)`, and `discoverSemesterDepartments(input, options)`.

- [ ] **Step 1: Write failing tests for a public shared request boundary**

Add tests proving that the desired exported request function retains current behavior rather than copying it:

```ts
test("fetchTestudoPage applies the existing HTML protections", async () => {
  const fetchImpl = vi.fn(async () =>
    new Response("<html><body>catalog</body></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
  );

  await expect(
    fetchTestudoPage("https://app.testudo.umd.edu/soc/202608", {
      fetchImpl,
      now: () => new Date("2026-09-02T12:00:00Z"),
    }),
  ).resolves.toMatchObject({
    html: "<html><body>catalog</body></html>",
    status: 200,
    fetchedAt: "2026-09-02T12:00:00.000Z",
  });
});
```

Keep all current timeout, retry, content-type, empty-response, authentication-page, and department/section wrapper tests unchanged.

- [ ] **Step 2: Run the fetch tests and verify RED**

Run: `npx vitest run src/testudo/fetch-department-page.test.ts`

Expected: FAIL because `fetchTestudoPage` is not exported.

- [ ] **Step 3: Export the existing generic request without changing behavior**

Change only its visibility and generalize the option/result names through aliases if needed:

```ts
export async function fetchTestudoPage(
  url: string,
  options: FetchDepartmentPageOptions = {},
): Promise<FetchDepartmentPageResult> {
  // Existing implementation remains the single retry/validation path.
}
```

Do not add a second request implementation.

- [ ] **Step 4: Run existing fetch tests and verify GREEN**

Run: `npx vitest run src/testudo/fetch-department-page.test.ts`

Expected: all existing and new fetch tests PASS.

- [ ] **Step 5: Add an offline semester-index fixture**

Create a minimal realistic fixture containing:

```html
<div class="course-prefix-row">
  <a href="/soc/202608/AAAS">AAAS African American and Africana Studies</a>
</div>
<a href="https://app.testudo.umd.edu/soc/202608/CMSC">
  CMSC Computer Science
</a>
<a href="/soc/202608/MATH">MATH Mathematics</a>
<a href="/soc/202608/CMSC">CMSC Duplicate</a>
<a href="/soc/202608/Cmsc">mixed-case path is invalid</a>
<a href="/soc/202608/CMSC216">course link is invalid</a>
<a href="https://example.com/soc/202608/ENGL">foreign origin is invalid</a>
<a href="/soc/202701/ENGL">wrong semester is invalid</a>
```

- [ ] **Step 6: Write failing parser and discovery tests**

Define the wished-for contract with literal results:

```ts
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
```

Add separate tests for invalid semester, empty discovery, whitespace normalization in names, request URL `https://app.testudo.umd.edu/soc/202608`, injected fetch behavior, and propagation of `TestudoFetchError` for bad HTML responses.

- [ ] **Step 7: Run discovery tests and verify RED**

Run: `npx vitest run src/testudo/discover-semester-departments.test.ts`

Expected: FAIL because the discovery module does not exist.

- [ ] **Step 8: Implement validated parsing and discovery**

Use these exact public shapes:

```ts
export interface TestudoDepartment {
  code: string;
  name: string;
  url: string;
}

export interface ParseSemesterDepartmentsInput {
  semester: string;
  html: string;
  sourceUrl: string;
}

export function buildSemesterUrl(semester: string): string;
export function parseSemesterDepartments(
  input: ParseSemesterDepartmentsInput,
): TestudoDepartment[];
export async function discoverSemesterDepartments(
  input: { semester: string },
  options?: FetchDepartmentPageOptions,
): Promise<TestudoDepartment[]>;
```

For each valid anchor, remove the leading code and normalize remaining visible whitespace for `name`. Deduplicate with a `Set<string>`, retain first occurrence, and throw a typed `SemesterDiscoveryError("NO_DEPARTMENTS_FOUND", ...)` when the final list is empty.

- [ ] **Step 9: Run all Testudo offline tests**

Run: `npx vitest run src/testudo/*.test.ts`

Expected: PASS with no changes to normalized department snapshots.

- [ ] **Step 10: Commit the discovery boundary**

```bash
git add src/testudo/fetch-department-page.ts src/testudo/fetch-department-page.test.ts src/testudo/discover-semester-departments.ts src/testudo/discover-semester-departments.test.ts src/testudo/fixtures/202608-departments.html
git commit -m "Discover Testudo departments"
```

### Task 2: Sequential full-catalog ingestion coordinator

**Files:**
- Create: `src/ingestion/ingest-department-catalog.ts`
- Create: `src/ingestion/ingest-department-catalog.test.ts`

**Interfaces:**
- Consumes: `AppDatabase`, `TestudoDepartment[]`, `collectDepartmentSnapshot`, and `persistDepartmentSnapshot`.
- Produces: `ingestDepartmentCatalog(db, options, dependencies)` and `DepartmentCatalogIngestionSummary`.

- [ ] **Step 1: Write failing happy-path sequencing and aggregate tests**

Use three literal departments and injected functions. Assert the exact trace:

```ts
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
```

Return literal snapshots and persistence results, then assert:

```ts
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
```

- [ ] **Step 2: Run coordinator tests and verify RED**

Run: `npx vitest run src/ingestion/ingest-department-catalog.test.ts`

Expected: FAIL because the coordinator module does not exist.

- [ ] **Step 3: Implement the minimal sequential coordinator**

Use exact options and result interfaces:

```ts
export interface IngestDepartmentCatalogOptions {
  semester: string;
  departments: readonly TestudoDepartment[];
  departmentDelayMs: number;
  signal: AbortSignal;
}

export interface DepartmentCatalogFailure {
  department: string;
  stage: "collection" | "persistence";
  code: string;
  message: string;
}

export interface DepartmentCatalogIngestionSummary {
  discovered: number;
  attempted: number;
  succeeded: number;
  failed: number;
  coursesParsed: number;
  sectionsParsed: number;
  observationsInserted: number;
  eventsInserted: number;
  failures: DepartmentCatalogFailure[];
  aborted: boolean;
}
```

Dependencies are exact injected boundaries:

```ts
export interface IngestDepartmentCatalogDependencies {
  collect?: typeof collectDepartmentSnapshot;
  persist?: typeof persistDepartmentSnapshot;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
}
```

Validate `departmentDelayMs` as a nonnegative safe integer. Build snapshots with `{ semester, department: department.code }`. Count only successfully persisted snapshots in course/section totals. Preserve the stable code from known typed errors; use `COLLECTION_FAILED` or `PERSISTENCE_FAILED` plus a generic message for unexpected errors. Never put raw unexpected error text in failure records.

- [ ] **Step 4: Run happy-path tests and verify GREEN**

Run: `npx vitest run src/ingestion/ingest-department-catalog.test.ts`

Expected: happy-path sequencing and summary tests PASS.

- [ ] **Step 5: Write failing isolation, delay, and abort tests**

Add literal tests proving:

- AAAS collection failure records `{ department: "AAAS", stage: "collection", code: "COLLECTION_FAILED" }`, waits, and still persists CMSC.
- CMSC persistence failure records `{ department: "CMSC", stage: "persistence", code: "PERSISTENCE_FAILED" }` and still collects MATH.
- No wait occurs after the last attempted department.
- Delay `0` remains a sequential boundary and calls injected wait with `0`.
- An already-aborted signal performs zero attempts.
- Abort during a wait prevents the next collection.
- Abort during collection allows that attempt to finish but starts no next department.
- Unexpected errors are represented as `"Department collection failed"` or `"Department persistence failed"`, never their raw message.

- [ ] **Step 6: Run isolation tests and verify RED**

Run: `npx vitest run src/ingestion/ingest-department-catalog.test.ts`

Expected: at least one new failure until continuation and abort branches exist.

- [ ] **Step 7: Implement failure isolation and cooperative abort**

Check `signal.aborted` before every collection and after every wait. Wrap collection and persistence separately so stage reporting is correct. The default wait removes its abort listener after resolving and ends immediately on abort.

- [ ] **Step 8: Run coordinator tests and verify GREEN**

Run: `npx vitest run src/ingestion/ingest-department-catalog.test.ts`

Expected: all coordinator tests PASS.

- [ ] **Step 9: Commit the catalog coordinator**

```bash
git add src/ingestion/ingest-department-catalog.ts src/ingestion/ingest-department-catalog.test.ts
git commit -m "Ingest departments sequentially"
```

### Task 3: One-time `ingest:all` command

**Files:**
- Create: `src/cli/ingest-all.ts`
- Create: `src/cli/ingest-all.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `discoverSemesterDepartments`, `createDatabaseConnection`, and `ingestDepartmentCatalog`.
- Produces: `parseIngestAllArgs(argv)`, `runAllDepartmentIngestion(argv, options)`, and package script `ingest:all`.

- [ ] **Step 1: Write failing argument tests**

Assert these literal contracts:

```ts
expect(parseIngestAllArgs(["--semester", "202608"])).toEqual({
  semester: "202608",
  departmentDelayMs: 5_000,
});
expect(
  parseIngestAllArgs([
    "--semester", "202608",
    "--department-delay-seconds", "0",
  ]),
).toEqual({ semester: "202608", departmentDelayMs: 0 });
```

Reject a missing semester, any semester other than `202608` at this product CLI, negative/fractional/nonnumeric delay, unknown flags, and `--department`.

- [ ] **Step 2: Run CLI tests and verify RED**

Run: `npx vitest run src/cli/ingest-all.test.ts`

Expected: FAIL because the CLI module does not exist.

- [ ] **Step 3: Implement CLI parsing**

Use `node:util` `parseArgs` with only:

```ts
options: {
  semester: { type: "string" },
  "department-delay-seconds": { type: "string" },
}
```

Return user-input errors as exit code `2` and a concise message.

- [ ] **Step 4: Write failing orchestration and cleanup tests**

Inject discovery, connection, coordinator, output, and an `AbortSignal`. Assert:

- Discovery happens before connection creation.
- One connection is created and its exact `db` reaches the coordinator.
- Discovered departments and parsed delay reach the coordinator unchanged.
- Summary success returns `0`; summary failures return `1`.
- Discovery failure creates no connection and returns `1`.
- Connection failure never calls the coordinator and returns `1`.
- Coordinator failure is sanitized and returns `1`.
- `close()` runs once on success and coordinator failure.
- Cleanup failure changes an otherwise successful exit to `1`.
- Output includes aggregate counts and failed department codes but excludes injected secret text.

- [ ] **Step 5: Run orchestration tests and verify RED**

Run: `npx vitest run src/cli/ingest-all.test.ts`

Expected: FAIL until the command lifecycle exists.

- [ ] **Step 6: Implement the command lifecycle and entry point**

Use an injectable options interface:

```ts
export interface AllDepartmentIngestionCliOptions {
  signal: AbortSignal;
  discover?: typeof discoverSemesterDepartments;
  connect?: () => { db: AppDatabase; close(): Promise<void> };
  ingest?: typeof ingestDepartmentCatalog;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
}
```

Register `SIGINT` and `SIGTERM` in `main`, pass the controller signal through, and always unregister handlers. Do not print raw unknown errors.

- [ ] **Step 7: Add the package command**

Add exactly:

```json
"ingest:all": "tsx src/cli/ingest-all.ts"
```

Leave `scrape`, `ingest:db`, and `ingest:worker` unchanged.

- [ ] **Step 8: Run all CLI and coordinator tests**

Run: `npx vitest run src/cli/*.test.ts src/ingestion/*.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit the one-time command**

```bash
git add package.json src/cli/ingest-all.ts src/cli/ingest-all.test.ts
git commit -m "Add full catalog ingestion command"
```

### Task 4: Rediscovering all-departments worker mode

**Files:**
- Create: `src/worker/all-departments-worker.ts`
- Create: `src/worker/all-departments-worker.test.ts`
- Modify: `src/cli/ingest-worker.ts`
- Modify: `src/cli/ingest-worker.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `runAllDepartmentIngestion` as a complete fresh-discovery cycle and the existing single-department `runIngestionWorker` unchanged.
- Produces: `runAllDepartmentsWorker(options, dependencies)` and a discriminated `IngestionWorkerConfig` with `mode: "single" | "all"`.

- [ ] **Step 1: Write failing recurring-cycle tests**

Use an injected `runCycle` and abort after two waits. Assert:

```ts
expect(sequence).toEqual([
  "cycle:202608:5000",
  "wait:300000",
  "cycle:202608:5000",
  "wait:300000",
]);
expect(runCycle).toHaveBeenCalledTimes(2);
```

The cycle boundary is deliberately the entire one-time command, so each invocation performs its own `discoverSemesterDepartments` call and cannot receive a cached list.

- [ ] **Step 2: Run all-departments worker tests and verify RED**

Run: `npx vitest run src/worker/all-departments-worker.test.ts`

Expected: FAIL because the worker module does not exist.

- [ ] **Step 3: Implement the recurring cycle runner**

Use:

```ts
export interface AllDepartmentsWorkerOptions {
  semester: "202608";
  departmentDelayMs: number;
  intervalMs: number;
  signal: AbortSignal;
}

export interface AllDepartmentsWorkerDependencies {
  runCycle(input: {
    semester: string;
    departmentDelayMs: number;
    signal: AbortSignal;
  }): Promise<number>;
  wait?: (intervalMs: number, signal: AbortSignal) => Promise<void>;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
}
```

Run immediately, sanitize unexpected cycle failures, wait after every completed/failed cycle unless aborted, and never retain department data in this module.

- [ ] **Step 4: Add failing failure and shutdown tests**

Cover a nonzero cycle exit followed by another cycle, a thrown secret-bearing error, abort during cycle, abort during wait, and confirmation that a failed second discovery/cycle never causes the first cycle's department list to be reused by the worker.

- [ ] **Step 5: Implement failure and shutdown branches and verify GREEN**

Run: `npx vitest run src/worker/*.test.ts`

Expected: both existing single-department and new all-departments worker tests PASS.

- [ ] **Step 6: Write failing worker CLI configuration tests**

Add exact cases for:

```ts
expect(
  parseIngestionWorkerArgs(
    ["--semester", "202608", "--all-departments"],
    {},
  ),
).toEqual({
  mode: "all",
  semester: "202608",
  intervalMs: 300_000,
  departmentDelayMs: 5_000,
});
```

Also cover `INGEST_ALL_DEPARTMENTS=true`, `INGEST_DEPARTMENT_DELAY_SECONDS=0`, explicit `false`, single-department compatibility, and rejection of all-mode combined with CLI or environment department, invalid booleans, non-`202608` all-mode semester, and invalid delay/interval values.

- [ ] **Step 7: Extend CLI parsing and dispatch**

Define:

```ts
export type IngestionWorkerConfig =
  | {
      mode: "single";
      semester: string;
      department: string;
      intervalMs: number;
    }
  | {
      mode: "all";
      semester: "202608";
      intervalMs: number;
      departmentDelayMs: number;
    };
```

In `runIngestionWorkerCommand`, preserve the existing single-mode call. All mode calls `runAllDepartmentsWorker`; each `runCycle` invocation calls `runAllDepartmentIngestion` with `--semester`, `--department-delay-seconds`, and the same signal. Do not pass departments between cycles.

- [ ] **Step 8: Add environment placeholders**

Add:

```dotenv
INGEST_ALL_DEPARTMENTS=false
INGEST_DEPARTMENT_DELAY_SECONDS=5
```

Retain the existing single-department placeholders.

- [ ] **Step 9: Run the complete worker and CLI suite**

Run: `npx vitest run src/worker/*.test.ts src/cli/*.test.ts`

Expected: PASS, including all pre-existing single-department expectations updated only where the new discriminant is intentional.

- [ ] **Step 10: Commit worker all-mode support**

```bash
git add .env.example src/worker/all-departments-worker.ts src/worker/all-departments-worker.test.ts src/cli/ingest-worker.ts src/cli/ingest-worker.test.ts
git commit -m "Refresh all departments in the worker"
```

### Task 5: Ingestion verification checkpoint

**Files:**
- Modify only files from Tasks 1–4 if verification identifies a regression.

**Interfaces:**
- Consumes: the completed discovery, batch coordinator, one-time command, and worker mode.
- Produces: a green ingestion subsystem ready for the cross-department search plan.

- [ ] **Step 1: Run whitespace and TypeScript checks**

Run: `git diff --check`

Expected: no output.

Run: `npm run typecheck`

Expected: exit `0`.

- [ ] **Step 2: Run the complete offline suite**

Run: `npm test`

Expected: all offline tests PASS.

- [ ] **Step 3: Run PostgreSQL integration tests**

Run: `npm run db:up`

Run: `npm run db:migrate`

Run: `npm run test:db`

Expected: all database integration tests PASS; no migration is generated for this subsystem.

- [ ] **Step 4: Verify CLI help/error boundaries without network access**

Run: `npm run ingest:all -- --semester invalid`

Expected: exit `2` with a sanitized semester error and no Testudo or database request.

- [ ] **Step 5: Commit any verification-only correction**

If a correction was required, stage only its named source and test files and commit with a message describing that behavior. If no correction was required, create no empty commit.
