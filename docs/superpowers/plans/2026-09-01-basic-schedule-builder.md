# Basic Schedule Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a browser-local selected-section list to the existing database-backed course search without changing database or ingestion behavior.

**Architecture:** Keep `CourseSearchPage` as the server data boundary and pass its normalized `CourseListItem[]` into a client `ScheduleWorkspace`. Put schedule transformation and collection operations in a pure module, and isolate guarded `localStorage` parsing and persistence in a second module so browser failures can be tested independently from React.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS, Vitest, Testing Library, jsdom

**Spec:** `docs/superpowers/specs/2026-09-01-basic-schedule-builder-design.md`

## Global Constraints

- Course search remains server-backed; do not move database queries into the client.
- Keep `CourseListItem` and all scraper, ingestion, worker, and PostgreSQL schemas unchanged.
- Do not add API routes, global state libraries, conflict detection, calendar visualization, accounts, database schedule persistence, named schedules, ranking, or automatic replacement.
- Multiple section IDs from the same course remain independent; only the exact `semester + courseId + sectionId` identity is deduplicated.
- Browser state uses the `umd-schedule-builder:schedule` key and a payload with `version: 1`.
- Invalid or inaccessible browser storage fails to an empty schedule and never blocks course search.
- Persistence must not write the initial empty React state before restoration finishes.
- Clearing removes the storage key and must not recreate an empty payload.

---

### Task 1: Pure schedule model and collection operations

**Files:**
- Create: `app/schedule.ts`
- Create: `app/schedule.test.ts`

**Interfaces:**
- Consumes: `CourseListItem` from `src/db/list-courses.ts`.
- Produces: `ScheduleSection`, `ScheduleMeeting`, `scheduleSectionKey(section)`, `createScheduleSection(semester, course, section)`, `addScheduleSection(sections, section)`, and `removeScheduleSection(sections, key)`.

- [ ] **Step 1: Write failing tests for deriving saved display data and stable identity**

Use a complete literal `CourseListItem` fixture and assert that `createScheduleSection("202608", course, course.sections[0])` returns only:

```ts
{
  semester: "202608",
  courseId: "CMSC216",
  courseTitle: "Introduction to Computer Systems",
  sectionId: "CMSC216-0101",
  sectionNumber: "0101",
  instructors: ["Ada Lovelace"],
  meetings: [{
    days: ["M", "W"],
    displayTime: "10:00am - 11:15am",
    building: "IRB",
    room: "0324",
    type: "Lecture",
  }],
}
```

Also assert that nullable meeting fields and empty instructor arrays are preserved, and that `scheduleSectionKey` differs for different section IDs.

- [ ] **Step 2: Run the model test and verify RED**

Run: `npx vitest run app/schedule.test.ts`

Expected: FAIL because `app/schedule.ts` and its exports do not exist.

- [ ] **Step 3: Implement the minimal saved model and derivation helpers**

Define focused types and copy arrays rather than retaining mutable references:

```ts
export interface ScheduleMeeting {
  days: string[];
  displayTime: string | null;
  building: string | null;
  room: string | null;
  type: string | null;
}

export interface ScheduleSection {
  semester: string;
  courseId: string;
  courseTitle: string;
  sectionId: string;
  sectionNumber: string;
  instructors: string[];
  meetings: ScheduleMeeting[];
}

export function scheduleSectionKey(section: ScheduleSection): string {
  return JSON.stringify([
    section.semester,
    section.courseId,
    section.sectionId,
  ]);
}
```

`createScheduleSection` maps the chosen `CourseListItem` and its section into this smaller object without seats, requirements, notes, credits, or numeric meeting times.

- [ ] **Step 4: Run the model test and verify GREEN**

Run: `npx vitest run app/schedule.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing collection-operation tests**

Add literal assertions that:

- Adding to `[]` returns one entry.
- Adding the same identity twice retains one entry.
- Adding two different section IDs for `CMSC216` retains both in insertion order.
- Removing the first key retains only the second object.
- Removing an unknown key leaves the collection unchanged.
- Clearing is represented by an empty array owned by the caller, with no special model mutation.

- [ ] **Step 6: Run the collection tests and verify RED**

Run: `npx vitest run app/schedule.test.ts`

Expected: FAIL because collection helpers are not implemented.

- [ ] **Step 7: Implement immutable add and remove operations**

```ts
export function addScheduleSection(
  sections: readonly ScheduleSection[],
  section: ScheduleSection,
): ScheduleSection[] {
  const key = scheduleSectionKey(section);
  return sections.some((current) => scheduleSectionKey(current) === key)
    ? [...sections]
    : [...sections, section];
}

export function removeScheduleSection(
  sections: readonly ScheduleSection[],
  key: string,
): ScheduleSection[] {
  return sections.filter((section) => scheduleSectionKey(section) !== key);
}
```

- [ ] **Step 8: Run the model tests and verify GREEN**

Run: `npx vitest run app/schedule.test.ts`

Expected: PASS.

### Task 2: Validated and failure-safe browser persistence

**Files:**
- Create: `app/schedule-storage.ts`
- Create: `app/schedule-storage.test.ts`

**Interfaces:**
- Consumes: `ScheduleSection` from `app/schedule.ts` and a minimal `ScheduleStorage` interface with `getItem`, `setItem`, and `removeItem` methods.
- Produces: `SCHEDULE_STORAGE_KEY`, `parseStoredSchedule(value)`, `serializeSchedule(sections)`, `loadSchedule(storage)`, `saveSchedule(storage, sections)`, and `clearStoredSchedule(storage)`.

- [ ] **Step 1: Write failing parsing and serialization tests**

Cover a hand-written valid V1 payload and assert an exact restored array. Add independent invalid cases for:

- Malformed JSON.
- `null`, arrays, and primitive root values.
- Missing or nonnumeric version.
- `version: 2`.
- Missing/non-array `sections`.
- A section missing each required scalar or array shape.
- Non-string instructor/day array members.
- Meetings with invalid objects or wrong nullable field types.

The expected value for every invalid case is `[]`. Assert `serializeSchedule(sections)` parses to `{ version: 1, sections }`.

- [ ] **Step 2: Run the storage test and verify RED**

Run: `npx vitest run app/schedule-storage.test.ts`

Expected: FAIL because `app/schedule-storage.ts` does not exist.

- [ ] **Step 3: Implement explicit unknown-data validation and serialization**

Use narrow type guards rather than a cast:

```ts
interface StoredScheduleV1 {
  version: 1;
  sections: ScheduleSection[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseStoredSchedule(value: string | null): ScheduleSection[] {
  if (value === null) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isStoredScheduleV1(parsed)) return [];
    return parsed.sections;
  } catch {
    return [];
  }
}
```

Validate every required scalar, every nested array element, and each nullable meeting field. Return newly copied section/meeting/array values so callers do not retain an unchecked parsed object.

- [ ] **Step 4: Run parsing tests and verify GREEN**

Run: `npx vitest run app/schedule-storage.test.ts`

Expected: PASS for parsing and serialization cases.

- [ ] **Step 5: Write failing storage API failure tests**

Use small in-memory adapters that throw from one method at a time. Assert:

- `loadSchedule` returns `[]` when `getItem` throws.
- `saveSchedule` does not throw when `setItem` throws.
- `clearStoredSchedule` does not throw when `removeItem` throws.
- A successful save calls `setItem` with `SCHEDULE_STORAGE_KEY` and a valid V1 payload.
- A successful clear calls `removeItem` with that key.

- [ ] **Step 6: Run API-boundary tests and verify RED**

Run: `npx vitest run app/schedule-storage.test.ts`

Expected: FAIL because guarded storage functions do not exist.

- [ ] **Step 7: Implement guarded storage operations**

Each API call receives its own `try/catch`; no error escapes to React:

```ts
export const SCHEDULE_STORAGE_KEY = "umd-schedule-builder:schedule";

export function loadSchedule(storage: ScheduleStorage): ScheduleSection[] {
  try {
    return parseStoredSchedule(storage.getItem(SCHEDULE_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function saveSchedule(
  storage: ScheduleStorage,
  sections: readonly ScheduleSection[],
): void {
  try {
    storage.setItem(SCHEDULE_STORAGE_KEY, serializeSchedule(sections));
  } catch {}
}

export function clearStoredSchedule(storage: ScheduleStorage): void {
  try {
    storage.removeItem(SCHEDULE_STORAGE_KEY);
  } catch {}
}
```

- [ ] **Step 8: Run storage tests and verify GREEN**

Run: `npx vitest run app/schedule-storage.test.ts`

Expected: PASS.

### Task 3: Client schedule workspace and search-result actions

**Files:**
- Create: `app/schedule-workspace.tsx`
- Create: `app/schedule-workspace.test.tsx`
- Modify: `app/course-search.tsx`
- Modify: `app/course-search.test.tsx`
- Modify: `app/course-search-page.tsx`
- Modify: `app/course-search-page.test.tsx`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: normalized `CourseListItem[]`, the Task 1 schedule operations, and Task 2 persistence functions.
- Produces: `ScheduleWorkspaceProps { courses?: CourseListItem[]; query?: string; status?: string; semester?: string }` and a client-rendered `ScheduleWorkspace` used exclusively by `CourseSearchPage`.
- Extends `CourseSearchProps` with optional `selectedSectionKeys?: ReadonlySet<string>` and `onAddSection?: (course, section) => void`, preserving standalone server rendering in its existing tests.

- [ ] **Step 1: Install DOM testing dependencies**

Run: `npm install --save-dev @testing-library/react jsdom`

Expected: `package.json` and `package-lock.json` contain compatible testing-only dependencies; runtime dependencies remain unchanged.

- [ ] **Step 2: Write failing client behavior tests**

In `app/schedule-workspace.test.tsx`, use `// @vitest-environment jsdom`, Testing Library, and a complete `CourseListItem` fixture with two sections of the same course. Reset `document.body` and `localStorage` between tests.

Test observable behavior:

- Empty schedule text renders initially when storage is empty.
- Clicking both `Add to schedule` actions produces two list items for the same course.
- The two buttons move to a disabled `Added` state.
- Re-clicking cannot create a duplicate.
- Removing one list item leaves the other.
- `Clear schedule` removes all items, returns to the empty message, and removes `SCHEDULE_STORAGE_KEY`.
- A valid saved payload is restored after mount and is not replaced by an empty V1 payload during initialization.
- Storage methods that throw during read, write, or removal do not prevent searching, adding, removing, or clearing in memory.

- [ ] **Step 3: Run the workspace tests and verify RED**

Run: `npx vitest run app/schedule-workspace.test.tsx`

Expected: FAIL because `ScheduleWorkspace` does not exist.

- [ ] **Step 4: Implement the client workspace with an initialization gate**

Create a focused client component:

```tsx
"use client";

export function ScheduleWorkspace({
  courses = [],
  query = "",
  status = "Enter a course ID or title to search.",
  semester = "202608",
}: ScheduleWorkspaceProps) {
  const [sections, setSections] = useState<ScheduleSection[]>([]);
  const [initialized, setInitialized] = useState(false);
  const skipInitialPersistence = useRef(true);

  useEffect(() => {
    setSections(loadSchedule(window.localStorage));
    setInitialized(true);
  }, []);

  useEffect(() => {
    if (!initialized) return;
    if (skipInitialPersistence.current) {
      skipInitialPersistence.current = false;
      return;
    }
    if (sections.length === 0) {
      clearStoredSchedule(window.localStorage);
    } else {
      saveSchedule(window.localStorage, sections);
    }
  }, [initialized, sections]);

  // Derive selected keys; add/remove with Task 1 helpers.
  // Render CourseSearch and the schedule panel.
}
```

The panel uses semantic headings and lists, displays honest instructor/meeting fallbacks, and labels each remove action with its course and section. The clear handler changes state only; the persistence effect performs one remove and never calls `setItem` for an empty array.

- [ ] **Step 5: Add section actions to the existing results presentation**

Extend `CourseSearch` without changing catalog display fields. For each section derive a candidate with `createScheduleSection`, use its stable key to determine selection, and render:

```tsx
<button
  disabled={selected}
  onClick={() => onAddSection?.(course, section)}
  type="button"
>
  {selected ? "Added" : "Add to schedule"}
</button>
```

Render the action only when `onAddSection` is supplied, so existing presentational tests and noninteractive callers remain valid.

- [ ] **Step 6: Route server results through the workspace**

Change only the rendered component in `CourseSearchPage`: import `ScheduleWorkspace` and replace all three `CourseSearch` return paths with the same props passed to `ScheduleWorkspace`. The query read, database search call, result counting, and safe error handling remain byte-for-byte equivalent in behavior.

- [ ] **Step 7: Run workspace and existing page tests and verify GREEN**

Run: `npx vitest run app/schedule.test.ts app/schedule-storage.test.ts app/schedule-workspace.test.tsx app/course-search.test.tsx app/course-search-page.test.tsx app/page.test.tsx`

Expected: PASS with no unhandled React updates or storage errors.

- [ ] **Step 8: Add regression assertions for rendering through the workspace**

Update server/page tests to assert that the workspace path still renders course descriptions, requirements, section instructors, meeting rows, and seat values from the literal existing fixtures. The production change these assertions catch is accidentally dropping normalized fields while introducing the client boundary.

- [ ] **Step 9: Run focused application tests again**

Run: `npx vitest run app/*.test.ts app/*.test.tsx`

Expected: PASS.

### Task 4: Full verification

**Files:**
- Modify only files from Tasks 1–3 if verification exposes a feature regression.

**Interfaces:**
- Consumes: the completed browser-local schedule builder.
- Produces: evidence that web, scraper, ingestion, worker, and database-search code still compile and pass offline tests.

- [ ] **Step 1: Run formatting-neutral diff validation**

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 2: Run TypeScript checks**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 3: Run the complete offline suite**

Run: `npm test`

Expected: PASS; database and live-network integration tests remain opt-in and excluded by the existing script.

- [ ] **Step 4: Run the production build**

Run: `npm run build`

Expected: PASS using the repository's existing Next.js build configuration.

- [ ] **Step 5: Review the final diff for scope**

Run: `git status --short` and `git diff -- app package.json package-lock.json docs/superpowers/specs/2026-09-01-basic-schedule-builder-design.md docs/superpowers/plans/2026-09-01-basic-schedule-builder.md`

Expected: no changes to scraper, database schema, ingestion pipeline, worker, or database query behavior from this feature; pre-existing user changes remain intact.
