# All-Departments Catalog Design

## Goal

Expand the Fall 2026 catalog from CMSC-only ingestion and search to every department published on Testudo. The application will discover departments from the official semester index, ingest them sequentially into the existing PostgreSQL model, keep them refreshed through the recurring worker, and let users search across the complete catalog with an optional department filter.

This remains a one-semester feature. The only supported semester is `202608`.

## Scope

This change includes:

- Dynamic department discovery from the official Testudo Fall 2026 index.
- A one-time command that ingests every discovered department.
- An all-departments mode for the recurring ingestion worker.
- Fresh department discovery at the beginning of every recurring cycle.
- Sequential, rate-limited department processing with per-department failure isolation.
- Cross-department course search capped at 50 displayed courses.
- An optional department-code filter populated from ingested catalog data.
- Live-search URL behavior that preserves the selected department.
- Offline fixtures and tests for discovery, orchestration, queries, worker cycles, and the website.
- An opt-in live full-catalog ingestion and representative database audit.

This change does not include:

- Semesters other than `202608`.
- Parallel or concurrent Testudo ingestion.
- Friendly department names in the website filter.
- A manually maintained department list.
- Calendar visualization, conflict detection, user accounts, or server-side schedule persistence.
- Changes to the existing per-department snapshot schema, seat-event semantics, or JSON snapshot command.

## Department Discovery

The discovery source is `https://app.testudo.umd.edu/soc/202608`. The application fetches the semester index directly and parses department links whose same-origin path has the exact shape `/soc/202608/{CODE}`, where `{CODE}` is four uppercase ASCII letters.

Each discovered entry contains:

- `code`: the normalized four-letter department code.
- `name`: the visible department name from Testudo, retained by the discovery result for logging and future use.
- `url`: the validated absolute Testudo department URL.

Discovery deduplicates by code while preserving Testudo's original order. Unrelated navigation links and malformed department links are ignored. A successful response that yields no departments is an error rather than an empty catalog, preventing a markup change or partial response from being treated as authoritative.

The fetch boundary uses the existing Testudo timeout, retry, response-content, and authentication-page protections. Semester validation remains six numeric characters. Parsing is independently testable against an offline Fall 2026 index fixture.

The department list is not hard-coded or cached across cycles. Every all-departments worker cycle starts with a new fetch and parse of the official semester index. If discovery fails, that cycle performs no department ingestions, reports the discovery error, waits for the configured cycle interval, and tries fresh discovery again during the next cycle.

## Full-Catalog Ingestion

The package adds:

```text
npm run ingest:all -- --semester 202608
```

The command performs these steps:

1. Validate the semester argument.
2. Discover the current department list from Testudo.
3. Open one provider-agnostic PostgreSQL connection using `DATABASE_URL`.
4. For each department in discovery order, collect the normalized in-memory `DepartmentSnapshot` through the existing fetch-and-parse pipeline.
5. Persist that snapshot through the existing `persistDepartmentSnapshot` transaction.
6. Wait five seconds by default before beginning the next department.
7. Close the shared database connection after every department has been attempted or shutdown is requested.

The inter-department delay is configurable with `--department-delay-seconds`; it accepts whole, nonnegative seconds and defaults to `5`. The delay occurs between attempts, including after a failed department, and is omitted after the final department. Fetch retries within one department continue using the existing fetch policy.

Each department retains its own database transaction. A collection or persistence failure for one department is recorded and processing continues with the next department. Previously successful departments are neither rolled back nor deleted. A failed department also retains its last successful database state because incomplete data is never persisted.

The command prints progress without dumping page contents or credentials. Its final summary includes:

- Departments discovered.
- Departments attempted, succeeded, and failed.
- Courses and sections parsed across successful snapshots.
- Seat observations and events inserted.
- A concise code and safe error message for each failed department.

The command exits `0` only when all discovered departments succeed. It exits `1` after completing the run when discovery, connection setup, cleanup, or any department attempt fails. Argument errors exit `2`, matching the existing CLI convention.

The existing `npm run ingest:db -- --semester <semester> --department <department>` and JSON `scrape` command keep their current behavior.

## Recurring Worker

The current single-department worker remains supported. All-departments mode is selected explicitly with `--all-departments` or `INGEST_ALL_DEPARTMENTS=true`; it is mutually exclusive with `--department` and `INGEST_DEPARTMENT`.

In all-departments mode, one cycle is:

1. Fetch and parse the semester index from Testudo.
2. Sequentially attempt every department returned by that fresh discovery.
3. Wait the configurable inter-department delay between attempts.
4. Emit one cycle summary.
5. Wait the existing worker interval before starting the next cycle.

The next cycle always repeats discovery from the official index. It never reuses an in-memory or persisted department list from an earlier cycle.

The default inter-department delay is five seconds and is configured with `--department-delay-seconds` or `INGEST_DEPARTMENT_DELAY_SECONDS`. The existing `--interval-seconds` / `INGEST_INTERVAL_SECONDS` default remains 300 seconds and represents the delay after a completed or failed cycle, not the delay between departments. `INGEST_ALL_DEPARTMENTS` accepts only `true` or `false`. Placeholder values are added to `.env.example`; real configuration remains in the ignored `.env` file.

Shutdown is cooperative. No new department begins after abort is requested, an active department attempt is allowed to finish, the shared connection is closed, and the worker reports that it stopped. Abort also ends either delay early.

A failure within one department is logged and does not stop the cycle. A discovery failure stops only the current cycle because no trustworthy work list exists. Both cases are retried through fresh discovery during the next cycle.

## Database Behavior

No migration is required for full-catalog ingestion. The existing schema already scopes courses, sections, ingestion heads, observations, and events by semester and department where needed.

Department discovery names are not persisted in this MVP. The existing `departments` table continues to store codes, populated by successful department ingestions. The website obtains its filter choices from distinct departments that have active courses for Fall 2026 and displays their codes.

Each successful department ingestion preserves current behavior:

- The first complete ingestion establishes its own baseline and creates no events.
- Later complete ingestions compare against that department's latest successful ingestion.
- Observations remain authoritative history.
- Objective seat changes and section additions/removals remain derived events.
- Retrying the same snapshot remains idempotent.
- Courses and sections are marked inactive only within the successfully ingested department.

A department missing from a later discovery response is not automatically deactivated. Global deactivation based on one index response would make a transient or partial index unsafe. Its last successfully ingested data remains available until a later product decision adds explicit semester-wide reconciliation.

## Cross-Department Search

`listCourses` makes its department constraint optional and accepts a result limit. When a department is supplied, the existing scoped behavior remains. When it is absent, active Fall 2026 courses from every ingested department are eligible.

Search continues matching course IDs and titles case-insensitively. Results retain deterministic course-ID ordering and the existing normalized `CourseListItem` representation, including requirements, active sections, instructors, meetings, and latest successful seat observations.

The website requests at most 51 matching courses from the database. It displays the first 50; the extra row determines whether results were truncated. A truncated response says `Showing the first 50 matching courses. Refine your search.` rather than claiming the total is 50.

The search page also loads the available Fall 2026 department codes. Failure to load either catalog search or department choices produces the existing safe unavailable state without exposing database details.

## Website Behavior

The fixed CMSC department field becomes a select control with:

- `All departments` as the default.
- One alphabetical option for each department code with active Fall 2026 courses.

The URL uses an optional `department` parameter. Omitting it means all departments. Invalid or unavailable department values fall back to all-department search rather than being passed unchecked to the database.

Live search remains immediate on every keystroke. When the course query changes, `router.replace` updates the query while preserving the selected department. When the department changes, it updates the department parameter while preserving the current query. Empty query and default-department values are omitted from the URL. URL updates continue using `replace`, so typing and filter changes do not create a long browser-history trail.

The form remains a GET fallback. The schedule builder and its browser-local saved section identity remain unchanged; sections from different departments can coexist because identity already includes semester, course ID, and section ID.

The page does not render the whole catalog for an empty query. It shows the search prompt and department filter, which avoids sending thousands of course and section records to the browser.

## Error Handling and Operational Safety

- Index fetching uses bounded retries and timeouts.
- Zero discovered departments is a hard discovery failure.
- Department attempts are sequential and separated by the configured delay.
- One department failure never fabricates a partial snapshot or blocks later departments.
- One department transaction never spans another department.
- Database credentials remain available only through `DATABASE_URL`.
- Logs include safe department context but no HTML, connection strings, or raw database errors.
- Search caps prevent broad one-character live searches from rendering the full catalog.
- Existing single-department commands remain available for targeted recovery.

## Testing

Offline tests cover:

- Fetching and parsing a representative semester index.
- Ignoring navigation and malformed links.
- Normalizing and deduplicating department codes in source order.
- Rejecting empty discovery results, invalid semesters, bad content, timeouts, and authentication pages.
- Sequential department ordering and the default/configured delay.
- Continuing after collection and persistence failures.
- Accurate aggregate summaries and exit codes.
- Shared connection cleanup on success, error, and abort.
- Worker rediscovery at the start of every cycle.
- No cached-list fallback when a later discovery fails.
- Cooperative shutdown during ingestion and delays.
- Cross-department queries, department-scoped queries, active-record filtering, latest seat data, deterministic ordering, and result limits.
- Available department-code listing.
- All-department and filtered page searches.
- Honest truncated-result status.
- Live query updates preserving the department parameter.
- Department changes preserving the query parameter.
- Empty/default values being omitted from the URL.
- Existing schedule selection and local persistence across catalog searches.
- No regressions in single-department scrape, database ingestion, or worker behavior.

After implementation, verification runs the complete offline suite, PostgreSQL integration suite, TypeScript check, and production Next.js build.

## Live Verification

With the local PostgreSQL container running and migrations applied, the opt-in live verification runs:

```text
npm run ingest:all -- --semester 202608
```

The completed run is audited for:

- Discovered, successful, and failed department counts.
- Total active courses and sections for Fall 2026.
- Representative active records and section data from `CMSC`, `MATH`, and `ENGL`.
- Department filter availability.
- Cross-department searches by both course ID and title.
- No partial ingestion records for failed departments.

Because Testudo is an external service and the complete sequential run is intentionally rate-limited, live failures are reported separately from deterministic offline verification. Successful department transactions remain valid and rerunning the command safely retries the catalog.

## Completion Criteria

The feature is complete when the application dynamically discovers the official Fall 2026 department list, can ingest every department sequentially through a one-time command, rediscovers and refreshes that list during every recurring worker cycle, and searches up to 50 matching courses across all successfully ingested departments with an optional department-code filter. Existing single-department workflows and schedule behavior remain intact, failure boundaries behave as specified, deterministic verification passes, and the live local catalog audit is reported.
