# PostgreSQL Data Model and Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist complete Testudo department snapshots into provider-agnostic PostgreSQL with a normalized current catalog, immutable seat observations, derived objective events, and an idempotent `ingest:db` command.

**Architecture:** Keep fetching/parsing independent from persistence by extracting an in-memory snapshot collector used by both JSON and database commands. Use Drizzle over `node-postgres` for a single serialized transaction per semester/department, with the exact snapshot stored as JSONB and normalized tables optimized for schedule and watch queries.

**Tech Stack:** Node.js 20+, TypeScript, PostgreSQL 17, Docker Compose, Drizzle ORM/Kit, node-postgres, Vitest

**Spec:** `docs/superpowers/specs/2026-08-26-postgresql-ingestion-design.md`

## Global Constraints

- Keep `npm run scrape -- --semester <semester> --department <department>` unchanged and independent from PostgreSQL.
- Configure application connections only through `DATABASE_URL`; accept an explicit connection string only for tests.
- Do not commit or hard-code credentials. Commit `.env.example`; ignore `.env` and local variants.
- Persist only complete snapshots. Reject partial, conflicting, and out-of-order snapshots without database side effects.
- Make exact retries idempotent by `(semester, department, collected_at)` plus snapshot JSON equality.
- Persist ingestion, catalog reconciliation, observations, events, and ingestion-head state in one transaction.
- Store observations as authoritative immutable history and events as a rebuildable query-optimized log.
- Preserve every objective event type already emitted by `compareDepartmentSnapshots`.
- Use application-generated UUIDs rather than a PostgreSQL UUID extension.
- Keep normal tests PostgreSQL-free; protect integration tests with an `_test` database-name guard.

---

### Task 1: Local PostgreSQL and Project Tooling

**Files:**
- Modify: `.gitignore`
- Create: `.env.example`
- Create: `docker-compose.yml`
- Create: `docker/postgres/init-test-db.sh`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `drizzle.config.ts`

**Interfaces:**
- Consumes: `.env` values `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_TEST_DB`, `POSTGRES_PORT`, `DATABASE_URL`, `TEST_DATABASE_URL`.
- Produces: Docker PostgreSQL service and package scripts `db:up`, `db:down`, `db:generate`, `db:migrate`, `db:studio`, `test:db`, and `ingest:db`.

- [ ] **Step 1: Install database dependencies**

Run:

```bash
npm install drizzle-orm pg dotenv
npm install --save-dev drizzle-kit @types/pg
```

Expected: `package.json` and `package-lock.json` include the five packages without changing existing dependency ranges.

- [ ] **Step 2: Add secret-safe environment files**

Add these ignore rules while keeping the example committed:

```gitignore
.env
.env.*
!.env.example
```

Create `.env.example`:

```dotenv
POSTGRES_USER=replace_me
POSTGRES_PASSWORD=replace_me
POSTGRES_DB=umd_schedule_builder
POSTGRES_TEST_DB=umd_schedule_builder_test
POSTGRES_PORT=5432
DATABASE_URL=postgresql://replace_me:replace_me@localhost:5432/umd_schedule_builder
TEST_DATABASE_URL=postgresql://replace_me:replace_me@localhost:5432/umd_schedule_builder_test
```

- [ ] **Step 3: Add Docker Compose and test-database initialization**

Create `docker-compose.yml` with `postgres:17-alpine`, `${...:?}` interpolation for every credential/database value, `${POSTGRES_PORT:-5432}:5432`, a named `postgres_data` volume, a `pg_isready` health check, and a read-only mount for `docker/postgres/init-test-db.sh` under `/docker-entrypoint-initdb.d/`.

Create `docker/postgres/init-test-db.sh`:

```sh
#!/bin/sh
set -eu

psql --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set test_database="$POSTGRES_TEST_DB" <<'SQL'
SELECT format('CREATE DATABASE %I', :'test_database')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'test_database')\gexec
SQL
```

- [ ] **Step 4: Add Drizzle and package configuration**

Create `drizzle.config.ts`:

```ts
import "dotenv/config";
import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL?.trim()) {
  throw new Error("DATABASE_URL is required");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL },
});
```

Add scripts:

```json
{
  "db:up": "docker compose up -d --wait",
  "db:down": "docker compose down",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "drizzle-kit migrate",
  "db:studio": "drizzle-kit studio",
  "ingest:db": "tsx src/cli/ingest-db.ts",
  "test:db": "RUN_DB_TESTS=true vitest run src/db/*.integration.test.ts"
}
```

- [ ] **Step 5: Validate committed configuration**

Run with non-secret temporary environment values:

```bash
POSTGRES_USER=test POSTGRES_PASSWORD=test POSTGRES_DB=app POSTGRES_TEST_DB=app_test POSTGRES_PORT=5432 docker compose config
npm run typecheck
git diff --check
```

Expected: Compose resolves without embedded real credentials, TypeScript passes, and the diff has no whitespace errors.

- [ ] **Step 6: Commit**

```bash
git add .gitignore .env.example docker-compose.yml docker/postgres/init-test-db.sh drizzle.config.ts package.json package-lock.json
git commit -m "Add local PostgreSQL tooling"
```

### Task 2: Database Connection and Test URL Safety

**Files:**
- Create: `src/db/connection.ts`
- Create: `src/db/connection.test.ts`
- Create: `src/db/test-database-url.ts`
- Create: `src/db/test-database-url.test.ts`
- Create: `src/db/schema.ts` initially exporting an empty schema object, completed in Task 3

**Interfaces:**
- Produces: `resolveDatabaseUrl(env?: NodeJS.ProcessEnv): string`.
- Produces: `createDatabaseConnection(options?: { connectionString?: string }): DatabaseConnection`.
- Produces: `DatabaseConnection = { db: AppDatabase; pool: Pool; close(): Promise<void> }`.
- Produces: `assertTestDatabaseUrl(value: string | undefined): string`.

- [ ] **Step 1: Write failing connection tests**

Test literal behavior:

```ts
expect(resolveDatabaseUrl({})).toThrowError("DATABASE_URL is required");
expect(resolveDatabaseUrl({ DATABASE_URL: "  " })).toThrowError("DATABASE_URL is required");
expect(resolveDatabaseUrl({ DATABASE_URL: "postgresql://localhost/app" }))
  .toBe("postgresql://localhost/app");
```

Test that `createDatabaseConnection({ connectionString })` constructs a pool without connecting eagerly and that `close()` calls `pool.end()` by supplying a narrow pool factory test option rather than opening a network connection.

- [ ] **Step 2: Write failing test-database guard tests**

```ts
expect(assertTestDatabaseUrl("postgresql://localhost/app_test"))
  .toBe("postgresql://localhost/app_test");
expect(() => assertTestDatabaseUrl("postgresql://localhost/app"))
  .toThrow("must end in _test");
expect(() => assertTestDatabaseUrl(undefined))
  .toThrow("TEST_DATABASE_URL is required");
```

- [ ] **Step 3: Run RED tests**

Run:

```bash
npx vitest run src/db/connection.test.ts src/db/test-database-url.test.ts
```

Expected: FAIL because the connection and guard modules do not exist.

- [ ] **Step 4: Implement connection lifecycle and safe configuration errors**

Implement `DatabaseConfigurationError` with code `DATABASE_URL_MISSING`. Build `Pool` with only `connectionString`, wrap it using `drizzle({ client: pool, schema })`, and expose an idempotent `close()` that ends the pool. Do not instantiate a pool during module import.

Implement `assertTestDatabaseUrl` by parsing with `new URL(value)`, decoding the final pathname segment, and requiring it to end with `_test`; never include the URL in thrown messages.

- [ ] **Step 5: Run GREEN tests and typecheck**

```bash
npx vitest run src/db/connection.test.ts src/db/test-database-url.test.ts
npm run typecheck
```

Expected: both test files pass without attempting a database connection.

- [ ] **Step 6: Commit**

```bash
git add src/db/connection.ts src/db/connection.test.ts src/db/test-database-url.ts src/db/test-database-url.test.ts src/db/schema.ts
git commit -m "Add PostgreSQL connection lifecycle"
```

### Task 3: Drizzle Schema and Initial Migration

**Files:**
- Modify: `src/db/schema.ts`
- Create: `src/db/schema.integration.test.ts`
- Create: `drizzle/0000_initial.sql` and Drizzle migration metadata generated by `drizzle-kit`

**Interfaces:**
- Produces: exported Drizzle tables `semesters`, `departments`, `departmentIngestions`, `departmentIngestionHeads`, `courses`, `courseRequirements`, `sections`, `sectionInstructors`, `sectionMeetings`, `seatObservations`, and `seatEvents`.
- Produces: `AppDatabase = NodePgDatabase<typeof schema>` from `connection.ts`.

- [ ] **Step 1: Write a failing real-schema integration test**

Gate the suite on `RUN_DB_TESTS === "true"`. Resolve `TEST_DATABASE_URL` through `assertTestDatabaseUrl`, connect explicitly, run Drizzle's `migrate()` against `./drizzle`, then query `information_schema.tables` and assert the literal table list above. Insert deliberately invalid rows to verify semester, department, nonnegative seat, and meeting-time checks reject bad data.

- [ ] **Step 2: Run the schema test RED**

```bash
RUN_DB_TESTS=true TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run src/db/schema.integration.test.ts
```

Expected: FAIL because the tables and migration do not exist.

- [ ] **Step 3: Implement the complete schema**

Use `pgTable`, `primaryKey`, `unique`, `index`, `check`, `foreignKey`, `uuid`, `text`, `timestamp`, `integer`, `numeric`, `boolean`, and `jsonb` from `drizzle-orm/pg-core`.

Define all columns, constraints, cascades, and indexes exactly as specified. Important executable checks include:

```ts
check("semesters_code_check", sql`${table.code} ~ '^[0-9]{6}$'`)
check("departments_code_check", sql`${table.code} ~ '^[A-Z]{4}$'`)
check("courses_credit_order_check", sql`${table.creditsMin} >= 0 and ${table.creditsMax} >= ${table.creditsMin}`)
check("section_meetings_time_pair_check", sql`(${table.startMinutes} is null) = (${table.endMinutes} is null)`)
check("section_meetings_time_range_check", sql`${table.startMinutes} between 0 and 1439 and ${table.endMinutes} between ${table.startMinutes} and 1439`)
check("seat_observations_counts_check", sql`${table.totalSeats} >= 0 and ${table.openSeats} >= 0 and (${table.waitlistCount} is null or ${table.waitlistCount} >= 0) and (${table.holdFileCount} is null or ${table.holdFileCount} >= 0)`)
```

Type JSONB columns with `$type<DepartmentSnapshot>()`, `$type<DepartmentSnapshot["summary"]>()`, `$type<DepartmentSnapshot["warnings"]>()`, and `$type<SnapshotComparisonEvent["previous"]>()` where appropriate. Use `{ mode: "number" }` for credit numerics so application values remain numbers.

- [ ] **Step 4: Generate and inspect the migration**

```bash
npm run db:generate -- --name initial
```

Expected: a committed SQL migration creates all eleven tables with the documented constraints and indexes. Inspect the SQL rather than using `drizzle-kit push`.

- [ ] **Step 5: Run GREEN schema verification**

```bash
npm run test:db -- src/db/schema.integration.test.ts
npm run typecheck
```

Expected: migration applies to an empty guarded test database and all constraint checks pass.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts src/db/schema.integration.test.ts drizzle
git commit -m "Define PostgreSQL catalog schema"
```

### Task 4: Extract In-Memory Department Collection

**Files:**
- Create: `src/testudo/collect-department-snapshot.ts`
- Create: `src/testudo/collect-department-snapshot.test.ts`
- Modify: `src/testudo/ingest-department.ts`
- Modify: `src/testudo/ingest-department.test.ts`

**Interfaces:**
- Produces: `collectDepartmentSnapshot(input: IngestDepartmentInput, options?: CollectDepartmentSnapshotOptions): Promise<DepartmentSnapshot>`.
- Preserves: `ingestDepartment(...)` return type and JSON write behavior.

- [ ] **Step 1: Write failing collector tests**

Move the fetch/section/build expectations currently embedded in `ingest-department.test.ts` into a focused collector test. Assert that it normalizes the department, passes all discovered course IDs to section fetching, and returns the in-memory snapshot without invoking file operations.

- [ ] **Step 2: Run RED test**

```bash
npx vitest run src/testudo/collect-department-snapshot.test.ts
```

Expected: FAIL because `collectDepartmentSnapshot` does not exist.

- [ ] **Step 3: Extract the existing pipeline**

Move only fetch/build behavior into the collector. Refactor `ingestDepartment` to call:

```ts
const snapshot = await collectDepartmentSnapshot(input, collectOptions);
const path = await writeDepartmentSnapshot(snapshot, writeOptions);
return { snapshot, path };
```

Keep existing dependency injection behavior so JSON tests and live tests remain deterministic.

- [ ] **Step 4: Verify collector and JSON behavior**

```bash
npx vitest run src/testudo/collect-department-snapshot.test.ts src/testudo/ingest-department.test.ts src/cli/scrape.test.ts
```

Expected: new collector tests and every existing JSON-ingestion test pass.

- [ ] **Step 5: Commit**

```bash
git add src/testudo/collect-department-snapshot.ts src/testudo/collect-department-snapshot.test.ts src/testudo/ingest-department.ts src/testudo/ingest-department.test.ts
git commit -m "Extract department snapshot collection"
```

### Task 5: Snapshot Persistence Mapping and Validation

**Files:**
- Create: `src/db/snapshot-records.ts`
- Create: `src/db/snapshot-records.test.ts`

**Interfaces:**
- Produces: `validatePersistableSnapshot(snapshot: DepartmentSnapshot): void`.
- Produces: `mapSnapshotRecords(snapshot, ingestionId)` returning literal arrays for course, requirement, section, instructor, meeting, and observation inserts.
- Produces: `mapSeatEventRecords(comparison, previousIngestionId, currentIngestionId, createId)`.
- Produces: typed `SnapshotPersistenceError` codes `PARTIAL_SNAPSHOT`, `IDEMPOTENCY_COLLISION`, `OUT_OF_ORDER_SNAPSHOT`, and `PERSISTENCE_FAILED`.

- [ ] **Step 1: Write failing mapping tests**

Use one hand-built complete snapshot containing a variable-credit course, ordered requirements, two instructors, scheduled and TBA meetings, nullable waitlist/hold-file counts, and section notes. Assert every exact row, including zero-based positions and unchanged nullable values.

Use a comparison containing numeric and section-presence events and assert exact JSONB previous/current values plus both ingestion IDs and deterministic IDs supplied by `createId`.

Assert a partial snapshot throws `SnapshotPersistenceError` with `code: "PARTIAL_SNAPSHOT"`.

- [ ] **Step 2: Run RED test**

```bash
npx vitest run src/db/snapshot-records.test.ts
```

Expected: FAIL because mapping and validation are absent.

- [ ] **Step 3: Implement pure mappings**

Return arrays shaped from Drizzle `$inferInsert` types. Preserve array order using callback indexes. Copy snapshot arrays rather than mutating them. Map event `previous` and `current` directly so JSON numbers, nulls, and seat objects retain their comparison representation.

- [ ] **Step 4: Run GREEN test**

```bash
npx vitest run src/db/snapshot-records.test.ts
npm run typecheck
```

Expected: all literal row assertions and validation behavior pass.

- [ ] **Step 5: Commit**

```bash
git add src/db/snapshot-records.ts src/db/snapshot-records.test.ts
git commit -m "Map snapshots to database records"
```

### Task 6: Transactional Snapshot Repository

**Files:**
- Create: `src/db/persist-department-snapshot.ts`
- Create: `src/db/persist-department-snapshot.integration.test.ts`

**Interfaces:**
- Produces: `persistDepartmentSnapshot(db: AppDatabase, snapshot: DepartmentSnapshot, options?: { createId?: () => string }): Promise<PersistDepartmentSnapshotResult>`.
- Produces: `PersistDepartmentSnapshotResult = { ingestionId: string; previousIngestionId: string | null; alreadyPersisted: boolean; observationsInserted: number; eventsInserted: number }`.

- [ ] **Step 1: Write the failing baseline and retry integration test**

Apply migrations, truncate the guarded test database, ingest a complete snapshot, and assert:

```ts
expect(result).toEqual({
  ingestionId: "00000000-0000-4000-8000-000000000001",
  previousIngestionId: null,
  alreadyPersisted: false,
  observationsInserted: 2,
  eventsInserted: 0,
});
```

Query all normalized tables and assert ordered metadata. Retry the exact object and assert the same ingestion ID, `alreadyPersisted: true`, and unchanged table counts.

- [ ] **Step 2: Write failing later-ingestion reconciliation test**

Ingest a later snapshot that changes counts, removes one section, adds another, and changes requirements/meetings. Assert observations are immutable, current rows update, missing rows become inactive, all comparison events exist, and every event references the exact previous/current ingestion IDs.

- [ ] **Step 3: Write failing safety and rollback tests**

Assert:

- Same key with changed snapshot throws `IDEMPOTENCY_COLLISION`.
- Earlier collection time throws `OUT_OF_ORDER_SNAPSHOT`.
- Partial input throws `PARTIAL_SNAPSHOT` before writes.
- A negative seat count reaches the PostgreSQL check after parent inserts, throws `PERSISTENCE_FAILED`, and leaves ingestion/catalog/head counts unchanged.

- [ ] **Step 4: Run repository tests RED**

```bash
npm run test:db -- src/db/persist-department-snapshot.integration.test.ts
```

Expected: FAIL because the repository does not exist.

- [ ] **Step 5: Implement the serialized transaction**

Inside `db.transaction`:

1. Upsert semester, department, and nullable head rows.
2. Lock the head using parameterized `SELECT ... FOR UPDATE` through Drizzle `sql`.
3. Query the unique ingestion key.
4. Use `isDeepStrictEqual` for exact retry versus collision.
5. Compare `Date.parse(snapshot.collectedAt)` to `latestCollectedAt` and reject non-later data.
6. Insert ingestion JSONB.
7. Mark the department's existing active courses/sections inactive, then upsert seen records active.
8. Delete and reinsert ordered children only for seen parents.
9. Insert observations.
10. Compare previous snapshot JSONB to current snapshot and insert mapped events.
11. Update the head last.

Catch known `SnapshotPersistenceError` unchanged. Wrap other errors in `PERSISTENCE_FAILED` with the original error as `cause` and the safe message `Database ingestion failed`.

- [ ] **Step 6: Run repository tests GREEN**

```bash
npm run test:db -- src/db/persist-department-snapshot.integration.test.ts
npm run typecheck
```

Expected: baseline, retry, reconciliation, provenance, safety, and rollback tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/db/persist-department-snapshot.ts src/db/persist-department-snapshot.integration.test.ts
git commit -m "Persist department snapshots transactionally"
```

### Task 7: Database Ingestion CLI

**Files:**
- Create: `src/cli/ingest-db.ts`
- Create: `src/cli/ingest-db.test.ts`

**Interfaces:**
- Produces: `runDatabaseIngestion(argv: string[], options?: DatabaseIngestionCliOptions): Promise<number>`.
- Reuses: `parseScrapeArgs`, `collectDepartmentSnapshot`, `createDatabaseConnection`, and `persistDepartmentSnapshot`.

- [ ] **Step 1: Write failing CLI tests**

Use dependency injection only at external boundaries. Assert:

- Missing/invalid semester or department returns 2 and does not create a connection.
- Success collects an in-memory snapshot, persists that same object, prints ingestion ID/observation/event counts, and closes once.
- An idempotent retry prints `already persisted` and returns 0.
- Collection, connection, and persistence failures return 1 with safe messages.
- Once a connection exists, it closes in `finally` on both success and failure.
- No JSON writer is imported or invoked.

- [ ] **Step 2: Run CLI test RED**

```bash
npx vitest run src/cli/ingest-db.test.ts
```

Expected: FAIL because the database CLI does not exist.

- [ ] **Step 3: Implement the CLI**

Follow the existing `scrape.ts` entrypoint guard. Use `parseScrapeArgs` for identical parameter validation. Default dependencies should collect, connect, and persist; injected dependencies keep offline tests network/database free.

Success output:

```text
Persisted ingestion <uuid> (<N> observations, <M> events)
```

Retry output:

```text
Ingestion <uuid> already persisted
```

Never print `DATABASE_URL`, PostgreSQL query strings, or raw driver errors that may contain credentials.

- [ ] **Step 4: Run CLI and regression tests GREEN**

```bash
npx vitest run src/cli/ingest-db.test.ts src/cli/scrape.test.ts src/testudo/ingest-department.test.ts
npm run typecheck
```

Expected: database CLI behavior passes and JSON scraper behavior remains unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/cli/ingest-db.ts src/cli/ingest-db.test.ts package.json
git commit -m "Add PostgreSQL ingestion command"
```

### Task 8: Full Verification and Live CMSC Ingestion

**Files:**
- Verify all changed files
- Create only ignored local `.env` and PostgreSQL volume state as needed

**Interfaces:**
- Consumes: local Docker PostgreSQL, committed migration, `DATABASE_URL`, `TEST_DATABASE_URL`, and live Testudo.
- Produces: verified first and second CMSC ingestions with idempotency and event provenance.

- [ ] **Step 1: Run static and offline verification**

```bash
npm run check
git diff --check
docker compose config
```

Expected: typecheck and all offline tests pass, the diff is clean, and Compose resolves from `.env` without revealing credentials in committed files.

- [ ] **Step 2: Start PostgreSQL and apply migrations**

```bash
npm run db:up
npm run db:migrate
```

Expected: PostgreSQL becomes healthy and the initial migration applies to the development database.

- [ ] **Step 3: Run the guarded integration suite**

```bash
npm run test:db
```

Expected: all real PostgreSQL migration, repository, constraint, rollback, and idempotency tests pass against the `_test` database.

- [ ] **Step 4: Run first live CMSC ingestion**

```bash
npm run ingest:db -- --semester 202608 --department CMSC
```

Expected: one complete ingestion, 95 normalized courses, 222 observations, zero baseline events, and an updated CMSC ingestion head.

- [ ] **Step 5: Verify exact retry idempotency**

Call `persistDepartmentSnapshot` with the exact stored snapshot object through a short checked script or focused integration test. A second live CLI call has a new collection timestamp and is therefore a new ingestion, not an exact retry.

Expected: the exact retry returns the original ingestion ID and changes no counts.

- [ ] **Step 6: Run a later live ingestion and audit events**

```bash
npm run ingest:db -- --semester 202608 --department CMSC
```

Expected: a later ingestion adds 222 observations and stores only objective changes. Query events to confirm previous/current ingestion IDs match the head chain and additions/removals use JSONB seat objects.

- [ ] **Step 7: Final verification**

```bash
npm run check
npm run test:db
git status --short
git diff --check
```

Expected: all offline and database tests pass and only intended committed source/migration files are present. If verification uncovers a defect, return to the task that owns that behavior, add a failing regression test, implement the scoped fix, rerun that task's verification, and commit the exact files named by that task.
