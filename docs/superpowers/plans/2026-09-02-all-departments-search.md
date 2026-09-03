# All-Departments Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Search up to 50 Fall 2026 courses across every ingested department and optionally filter results by an available department code.

**Architecture:** Generalize the existing Drizzle course query with an optional department and bounded row limit while preserving its normalized return type. Add a separate active-department query, compose both through the server page, and extend the existing client workspace with pure URL construction so live query and filter changes preserve each other without moving database access into the browser.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Drizzle ORM, PostgreSQL, Tailwind CSS, Vitest, Testing Library, jsdom

**Spec:** `docs/superpowers/specs/2026-09-02-all-departments-catalog-design.md`

## Global Constraints

- The website supports only Fall 2026 (`202608`).
- Keep all database access in server modules and retain `CourseListItem` unchanged.
- Global search is the default; the department constraint is optional.
- Display at most 50 courses and fetch one extra row only to detect truncation.
- Blank search renders no catalog results.
- Department choices come from active ingested courses and display codes only.
- Invalid or unavailable department URL values fall back to all departments.
- Live query and filter changes use `router.replace`, preserve each other, and omit empty/default URL parameters.
- Do not change scraper parsing, ingestion transactions, seat-event behavior, or browser-local schedule identity.

---

### Task 1: Optional department scope and bounded database results

**Files:**
- Modify: `src/db/list-courses.ts`
- Create: `src/db/list-courses.test.ts`
- Modify: `src/db/list-courses.integration.test.ts`

**Interfaces:**
- Consumes: the existing normalized course, child-row, and latest-observation queries.
- Produces: `ListCoursesScope { semester: string; department?: string; query?: string; limit?: number }` while preserving `Promise<CourseListItem[]>`.

- [ ] **Step 1: Write failing integration tests for global and scoped search**

Extend the controlled database fixture with active `MATH140`, inactive `MATH141`, and another semester's `ENGL101`. Assert:

```ts
expect(
  (await listCourses(db, { semester: "202608", query: "calculus" }))
    .map((course) => course.id),
).toEqual(["MATH140"]);

expect(
  (await listCourses(db, {
    semester: "202608",
    department: "CMSC",
    query: "introduction",
  })).map((course) => course.id),
).toEqual(["CMSC216"]);
```

Assert global results still include complete requirements, active sections, instructors, meetings, and the seat observation from each section's own latest department ingestion.

- [ ] **Step 2: Run the database integration test and verify RED**

Run: `RUN_DB_TESTS=true npx vitest run --no-file-parallelism src/db/list-courses.integration.test.ts`

Expected: the global case FAILS because the current query requires a department.

- [ ] **Step 3: Make department filtering conditional**

Change the interface and `where` expression only:

```ts
export interface ListCoursesScope {
  semester: string;
  department?: string;
  query?: string;
  limit?: number;
}

and(
  eq(courses.semesterCode, scope.semester),
  scope.department
    ? eq(courses.departmentCode, scope.department)
    : undefined,
  eq(courses.isActive, true),
  searchCondition,
)
```

Update latest-ingestion lookup so global results associate every department with its own ingestion head rather than reading one head. Query the relevant heads and map by department before loading observations.

- [ ] **Step 4: Run global/scoped integration tests and verify GREEN**

Run: `RUN_DB_TESTS=true npx vitest run --no-file-parallelism src/db/list-courses.integration.test.ts`

Expected: global and existing scoped normalized results PASS.

- [ ] **Step 5: Write failing result-limit validation tests**

Seed at least three deterministic course IDs and assert:

```ts
expect(
  (await listCourses(db, { semester: "202608", query: "", limit: 2 }))
    .map(({ id }) => id),
).toEqual(["CMSC131", "CMSC216"]);
```

Add offline unit coverage in `src/db/list-courses.test.ts` that passes a throwing database stub and proves `limit: 0`, negative, fractional, and unsafe integers throw `RangeError("limit must be a positive safe integer")` before any database method is reached.

- [ ] **Step 6: Run limit tests and verify RED**

Run: `npx vitest run src/db/list-courses.test.ts`

Expected: limit assertions FAIL because the query is currently unbounded.

- [ ] **Step 7: Implement deterministic limiting**

Validate `scope.limit` before building queries. Apply `.limit(scope.limit)` only to the ordered top-level course query; child queries naturally remain limited to those returned course IDs.

- [ ] **Step 8: Run list-course tests and verify GREEN**

Run: `npx vitest run src/db/list-courses.test.ts`

Run: `RUN_DB_TESTS=true npx vitest run --no-file-parallelism src/db/list-courses.integration.test.ts`

Expected: all list-course integration tests PASS.

- [ ] **Step 9: Commit generalized course listing**

```bash
git add src/db/list-courses.ts src/db/list-courses.test.ts src/db/list-courses.integration.test.ts
git commit -m "Search courses across departments"
```

### Task 2: Available department-code query

**Files:**
- Create: `src/db/list-department-codes.ts`
- Create: `src/db/list-department-codes.integration.test.ts`

**Interfaces:**
- Consumes: `AppDatabase` and the existing `courses` table.
- Produces: `listDepartmentCodes(db, { semester }): Promise<string[]>`.

- [ ] **Step 1: Write a failing controlled integration test**

Seed active/inactive and cross-semester rows, then assert:

```ts
await expect(
  listDepartmentCodes(db, { semester: "202608" }),
).resolves.toEqual(["CMSC", "ENGL", "MATH"]);
```

Include duplicate courses within CMSC to prove codes are distinct, an inactive-only department to prove it is omitted, and `202701` rows to prove semester isolation.

- [ ] **Step 2: Run the department-code test and verify RED**

Run: `RUN_DB_TESTS=true npx vitest run --no-file-parallelism src/db/list-department-codes.integration.test.ts`

Expected: FAIL because the query module does not exist.

- [ ] **Step 3: Implement the active-code query**

Use the exact interface:

```ts
export interface ListDepartmentCodesScope {
  semester: string;
}

export async function listDepartmentCodes(
  db: AppDatabase,
  scope: ListDepartmentCodesScope,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ code: courses.departmentCode })
    .from(courses)
    .where(
      and(
        eq(courses.semesterCode, scope.semester),
        eq(courses.isActive, true),
      ),
    )
    .orderBy(asc(courses.departmentCode));
  return rows.map(({ code }) => code);
}
```

- [ ] **Step 4: Run the department-code integration test and verify GREEN**

Run: `RUN_DB_TESTS=true npx vitest run --no-file-parallelism src/db/list-department-codes.integration.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the department query**

```bash
git add src/db/list-department-codes.ts src/db/list-department-codes.integration.test.ts
git commit -m "List active catalog departments"
```

### Task 3: Server catalog search result and page composition

**Files:**
- Modify: `app/search-course-catalog.ts`
- Modify: `app/search-course-catalog.test.ts`
- Modify: `app/course-search-page.tsx`
- Modify: `app/course-search-page.test.tsx`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `listCourses`, `listDepartmentCodes`, server search parameters `query` and `department`.
- Produces: `CatalogSearchResult { courses: CourseListItem[]; truncated: boolean }`, `searchCourseCatalog(query, department?, dependencies)`, and `listCatalogDepartmentCodes(dependencies)`.

- [ ] **Step 1: Write failing catalog-adapter tests**

Assert the exact database scopes:

```ts
expect(receivedScope).toEqual({
  semester: "202608",
  department: undefined,
  query: "calculus",
  limit: 51,
});
```

Repeat with `department: "MATH"`. Return 51 literal course objects and assert the adapter returns the first 50 plus `truncated: true`; return 50 and assert `truncated: false`. Assert `listCatalogDepartmentCodes` calls its dependency with `{ semester: "202608" }`.

- [ ] **Step 2: Run adapter tests and verify RED**

Run: `npx vitest run app/search-course-catalog.test.ts`

Expected: FAIL because the current adapter hard-codes CMSC and returns an array.

- [ ] **Step 3: Implement bounded catalog adapters**

Use:

```ts
export interface CatalogSearchResult {
  courses: CourseListItem[];
  truncated: boolean;
}

export async function searchCourseCatalog(
  query: string,
  department: string | undefined,
  dependencies: SearchCourseCatalogDependencies = {},
): Promise<CatalogSearchResult> {
  const matches = await list(database, {
    semester: "202608",
    department,
    query,
    limit: 51,
  });
  return { courses: matches.slice(0, 50), truncated: matches.length > 50 };
}
```

Add `listCatalogDepartmentCodes` through the same lazily reused provider-agnostic database connection.

- [ ] **Step 4: Run adapter tests and verify GREEN**

Run: `npx vitest run app/search-course-catalog.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing server-page tests**

Change the injected page dependencies to mirror real return types. Cover:

- Blank query loads department codes but does not call search.
- Missing department performs global search.
- Available `MATH` passes `MATH` to search and renders it selected.
- Lowercase `math` normalizes to `MATH`.
- Unknown `XXXX` falls back to global search and `All departments`.
- 0/1/many result status remains correct.
- Truncated status is exactly `Showing the first 50 matching courses. Refine your search.`
- A database failure produces the existing safe unavailable message with no raw secret.

Use literal departments `["CMSC", "ENGL", "MATH"]` and full `CourseListItem` fixtures.

- [ ] **Step 6: Run page tests and verify RED**

Run: `npx vitest run app/course-search-page.test.tsx app/page.test.tsx`

Expected: FAIL because page search parameters and workspace props do not support departments or truncation.

- [ ] **Step 7: Implement server parameter validation and composition**

Extend `SearchParams` with `department?: string | string[]`. Normalize scalar input to uppercase and accept it only when included in the loaded code list. Call search only for a nonblank query. Pass `departmentCodes`, `department`, `courses`, `query`, and status to `ScheduleWorkspace`.

Keep one safe `try/catch` around catalog server work and never render the caught error. Update `HomePageProps` in `app/page.tsx` to include the department parameter.

- [ ] **Step 8: Run adapter/page tests and verify GREEN**

Run: `npx vitest run app/search-course-catalog.test.ts app/course-search-page.test.tsx app/page.test.tsx`

Expected: PASS.

- [ ] **Step 9: Commit server-side catalog composition**

```bash
git add app/search-course-catalog.ts app/search-course-catalog.test.ts app/course-search-page.tsx app/course-search-page.test.tsx app/page.tsx app/page.test.tsx
git commit -m "Load all-department catalog search"
```

### Task 4: Department filter and URL-preserving live search

**Files:**
- Create: `app/catalog-search-url.ts`
- Create: `app/catalog-search-url.test.ts`
- Modify: `app/course-search.tsx`
- Modify: `app/course-search.test.tsx`
- Modify: `app/schedule-workspace.tsx`
- Modify: `app/schedule-workspace.test.tsx`

**Interfaces:**
- Consumes: server-provided `departmentCodes`, selected `department`, and current uncontrolled search input value.
- Produces: `buildCatalogSearchUrl({ query, department })`, `onDepartmentChange`, and a department select that preserves the live query.

- [ ] **Step 1: Write failing pure URL tests**

Assert hand-derived values:

```ts
expect(buildCatalogSearchUrl({ query: "CMSC 216&" })).toBe(
  "/?query=CMSC+216%26",
);
expect(
  buildCatalogSearchUrl({ query: "calculus", department: "MATH" }),
).toBe("/?query=calculus&department=MATH");
expect(buildCatalogSearchUrl({ query: "", department: "MATH" })).toBe(
  "/?department=MATH",
);
expect(buildCatalogSearchUrl({ query: "", department: undefined })).toBe("/");
```

- [ ] **Step 2: Run URL tests and verify RED**

Run: `npx vitest run app/catalog-search-url.test.ts`

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement the URL helper**

Use `URLSearchParams`, append `query` first and `department` second only when nonempty, and return `/` when no parameters remain.

- [ ] **Step 4: Run URL tests and verify GREEN**

Run: `npx vitest run app/catalog-search-url.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing filter rendering tests**

In `course-search.test.tsx`, pass `departmentCodes={["CMSC", "ENGL", "MATH"]}` and `department="MATH"`. Assert a named `<select name="department">` contains `All departments` followed by the three codes and selects MATH. Assert the former read-only CMSC input is absent. Keep all course metadata/section assertions unchanged.

- [ ] **Step 6: Write failing live interaction tests**

In the jsdom workspace tests, initialize with `query="calculus"`, `department="MATH"`, and the literal codes. Assert:

```ts
fireEvent.change(searchbox, { target: { value: "linear algebra" } });
expect(router.replace).toHaveBeenLastCalledWith(
  "/?query=linear+algebra&department=MATH",
  { scroll: false },
);

fireEvent.change(departmentSelect, { target: { value: "ENGL" } });
expect(router.replace).toHaveBeenLastCalledWith(
  "/?query=linear+algebra&department=ENGL",
  { scroll: false },
);
```

Also assert selecting `All departments` removes only the department parameter, clearing the query preserves the department, and saved schedule sections remain rendered through navigation changes.

- [ ] **Step 7: Run component tests and verify RED**

Run: `npx vitest run app/course-search.test.tsx app/schedule-workspace.test.tsx`

Expected: FAIL because the filter and parameter-preserving handlers do not exist.

- [ ] **Step 8: Implement department presentation and workspace navigation**

Extend props exactly:

```ts
interface CourseSearchProps {
  department?: string;
  departmentCodes?: string[];
  onDepartmentChange?: (department: string | undefined) => void;
  // existing props remain
}

interface ScheduleWorkspaceProps {
  department?: string;
  departmentCodes?: string[];
  // existing props remain
}
```

Replace the read-only input with a select whose empty value means all departments. In `ScheduleWorkspace`, keep `currentQueryRef` synchronized on every input event so a department change preserves text typed ahead of the latest server response. Both handlers call `buildCatalogSearchUrl` and `router.replace(url, { scroll: false })` immediately.

- [ ] **Step 9: Run all web tests and verify GREEN**

Run: `npx vitest run app/*.test.ts app/*.test.tsx`

Expected: PASS with no React hydration, controlled/uncontrolled, or router-context warnings.

- [ ] **Step 10: Commit the website filter**

```bash
git add app/catalog-search-url.ts app/catalog-search-url.test.ts app/course-search.tsx app/course-search.test.tsx app/schedule-workspace.tsx app/schedule-workspace.test.tsx
git commit -m "Add all-department course filtering"
```

### Task 5: Complete verification and live catalog audit

**Files:**
- Modify only files from the approved ingestion/search plans if a verified regression requires correction.

**Interfaces:**
- Consumes: both completed all-departments implementation plans.
- Produces: deterministic verification plus a populated/audited local Fall 2026 catalog.

- [ ] **Step 1: Run static and offline verification**

Run: `git diff --check`

Expected: no output.

Run: `npm run typecheck`

Expected: exit `0`.

Run: `npm test`

Expected: all offline tests PASS.

- [ ] **Step 2: Run database integration verification**

Run: `npm run db:up`

Run: `npm run db:migrate`

Run: `npm run test:db`

Expected: all PostgreSQL integration tests PASS.

- [ ] **Step 3: Run the production web build**

Run: `npm run build`

Expected: Next.js production compilation, TypeScript phase, and page generation PASS using the existing webpack configuration.

- [ ] **Step 4: Run the rate-limited live Fall 2026 ingestion**

Run:

```bash
npm run ingest:all -- --semester 202608
```

Expected: discovery reports the official department count, each department is attempted sequentially with five-second spacing, and the final summary identifies all successes/failures. If the external run is interrupted, rerun the same command; completed per-department snapshots remain valid and idempotent.

- [ ] **Step 5: Audit local catalog totals and representative departments**

Use `psql` through the configured local container without printing `DATABASE_URL`:

```sql
select count(*) as active_courses
from courses
where semester_code = '202608' and is_active;

select count(*) as active_sections
from sections
where semester_code = '202608' and is_active;

select department_code, count(*) as active_courses
from courses
where semester_code = '202608'
  and is_active
  and department_code in ('CMSC', 'MATH', 'ENGL')
group by department_code
order by department_code;
```

Expected: nonzero overall totals and nonzero counts for CMSC, MATH, and ENGL. Query one representative course from each and confirm sections plus latest observations are present.

- [ ] **Step 6: Audit application search behavior**

Verify server adapters or the running local page return results for `CMSC216`, `MATH140`, and an ENGL title query; verify the department dropdown includes CMSC, MATH, and ENGL; verify a one-character query never renders more than 50 courses.

- [ ] **Step 7: Record external failures honestly**

If any live department failed, report its code and sanitized stage/message. Do not weaken offline tests or treat partial live success as a deterministic failure. Rerun targeted single-department ingestion with:

```bash
npm run ingest:db -- --semester 202608 --department CODE
```

Replace `CODE` with each reported four-letter department code, then rerun the audit.

- [ ] **Step 8: Commit verification corrections only when needed**

If live or deterministic verification required a code correction, first add a failing offline regression test, apply the smallest fix, rerun Steps 1–3, and commit only the named source/test files with a behavior-specific message. Otherwise create no empty commit.
