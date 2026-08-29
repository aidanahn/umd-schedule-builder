import "dotenv/config";

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import type { DepartmentSnapshot } from "../testudo/build-department-snapshot.js";
import {
  createDatabaseConnection,
  type DatabaseConnection,
} from "./connection.js";
import { persistDepartmentSnapshot } from "./persist-department-snapshot.js";
import { assertTestDatabaseUrl } from "./test-database-url.js";

const describeDatabase =
  process.env.RUN_DB_TESTS === "true" ? describe : describe.skip;

function baselineSnapshot(): DepartmentSnapshot {
  return {
    schemaVersion: 1,
    semester: "202608",
    department: "CMSC",
    collectedAt: "2026-08-29T12:00:00.000Z",
    sourceUrl: "https://app.testudo.umd.edu/soc/202608/CMSC",
    status: "complete",
    summary: {
      coursesFound: 1,
      coursesParsed: 1,
      coursesFailed: 0,
      sectionsParsed: 2,
    },
    courses: [
      {
        id: "CMSC498A",
        department: "CMSC",
        title: "Selected Topics in Computer Science",
        credits: { min: 1, max: 3 },
        gradingMethods: ["Regular"],
        genEdCodes: [],
        description: "An advanced selected-topics course.",
        requirements: [
          { label: "Prerequisite", text: "CMSC330." },
          { label: "Restriction", text: "Permission of department." },
        ],
        sections: [
          {
            id: "CMSC498A-0101",
            number: "0101",
            instructors: ["Ada Lovelace", "Grace Hopper"],
            deliveryMode: "face-to-face",
            notes: ["Seats reserved for majors."],
            seats: { total: 25, open: 5, waitlist: 0, holdFile: null },
            meetings: [
              {
                days: ["M", "W"],
                startMinutes: 600,
                endMinutes: 675,
                displayTime: "10:00am - 11:15am",
                building: "IRB",
                room: "1207",
                type: "Lecture",
              },
            ],
          },
          {
            id: "CMSC498A-0201",
            number: "0201",
            instructors: ["Alan Turing"],
            deliveryMode: "online",
            notes: [],
            seats: { total: 20, open: 1, waitlist: null, holdFile: 0 },
            meetings: [
              {
                days: [],
                startMinutes: null,
                endMinutes: null,
                displayTime: null,
                building: null,
                room: null,
                type: null,
              },
            ],
          },
        ],
      },
    ],
    warnings: [],
    failures: [],
  };
}

function laterSnapshot(): DepartmentSnapshot {
  const snapshot = structuredClone(baselineSnapshot());
  snapshot.collectedAt = "2026-08-29T12:05:00.000Z";
  snapshot.courses[0]!.requirements = [
    { label: "Recommended", text: "CMSC433." },
  ];
  snapshot.courses[0]!.sections = [
    {
      ...snapshot.courses[0]!.sections[0]!,
      instructors: ["Katherine Johnson"],
      seats: { total: 25, open: 0, waitlist: 2, holdFile: null },
      meetings: [
        {
          days: ["Tu", "Th"],
          startMinutes: 840,
          endMinutes: 915,
          displayTime: "2:00pm - 3:15pm",
          building: "IRB",
          room: "2207",
          type: "Lecture",
        },
      ],
    },
    {
      ...snapshot.courses[0]!.sections[1]!,
      id: "CMSC498A-0301",
      number: "0301",
      seats: { total: 20, open: 3, waitlist: null, holdFile: 0 },
    },
  ];
  return snapshot;
}

function idSequence(...ids: string[]): () => string {
  return () => {
    const id = ids.shift();
    if (!id) {
      throw new Error("test ID sequence exhausted");
    }
    return id;
  };
}

const firstIngestionId = "00000000-0000-4000-8000-000000000001";
const secondIngestionId = "00000000-0000-4000-8000-000000000002";

describeDatabase("persistDepartmentSnapshot", () => {
  let connection: DatabaseConnection;

  beforeAll(async () => {
    const connectionString = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);
    connection = createDatabaseConnection({ connectionString });
    await connection.pool.query("drop schema if exists drizzle cascade");
    await connection.pool.query("drop schema public cascade");
    await connection.pool.query("create schema public");
    await migrate(connection.db, { migrationsFolder: "./drizzle" });
  });

  beforeEach(async () => {
    await connection.pool.query("truncate table semesters, departments cascade");
  });

  afterAll(async () => {
    await connection?.close();
  });

  test("persists a baseline and treats an exact retry as a no-op", async () => {
    const snapshot = baselineSnapshot();
    const createId = idSequence(firstIngestionId);

    await expect(
      persistDepartmentSnapshot(connection.db, snapshot, { createId }),
    ).resolves.toEqual({
      ingestionId: firstIngestionId,
      previousIngestionId: null,
      alreadyPersisted: false,
      observationsInserted: 2,
      eventsInserted: 0,
    });

    await expect(
      persistDepartmentSnapshot(connection.db, snapshot, { createId }),
    ).resolves.toEqual({
      ingestionId: firstIngestionId,
      previousIngestionId: null,
      alreadyPersisted: true,
      observationsInserted: 0,
      eventsInserted: 0,
    });

    const counts = await connection.pool.query<{
      ingestions: number;
      observations: number;
      events: number;
    }>(`
      select
        (select count(*)::int from department_ingestions) as ingestions,
        (select count(*)::int from seat_observations) as observations,
        (select count(*)::int from seat_events) as events
    `);
    expect(counts.rows[0]).toEqual({
      ingestions: 1,
      observations: 2,
      events: 0,
    });

    const requirements = await connection.pool.query<{
      position: number;
      label: string;
    }>("select position, label from course_requirements order by position");
    expect(requirements.rows).toEqual([
      { position: 0, label: "Prerequisite" },
      { position: 1, label: "Restriction" },
    ]);

    const instructors = await connection.pool.query<{
      position: number;
      name: string;
    }>(`
      select position, name from section_instructors
      where section_id = 'CMSC498A-0101' order by position
    `);
    expect(instructors.rows).toEqual([
      { position: 0, name: "Ada Lovelace" },
      { position: 1, name: "Grace Hopper" },
    ]);
  });

  test("serializes concurrent retries for the same department snapshot", async () => {
    const snapshot = baselineSnapshot();
    const results = await Promise.all([
      persistDepartmentSnapshot(connection.db, snapshot, {
        createId: () => firstIngestionId,
      }),
      persistDepartmentSnapshot(connection.db, snapshot, {
        createId: () => secondIngestionId,
      }),
    ]);

    const inserted = results.find(({ alreadyPersisted }) => !alreadyPersisted);
    const retried = results.find(({ alreadyPersisted }) => alreadyPersisted);

    expect(inserted).toMatchObject({
      previousIngestionId: null,
      alreadyPersisted: false,
      observationsInserted: 2,
      eventsInserted: 0,
    });
    expect(retried).toEqual({
      ingestionId: inserted?.ingestionId,
      previousIngestionId: null,
      alreadyPersisted: true,
      observationsInserted: 0,
      eventsInserted: 0,
    });

    const counts = await connection.pool.query<{
      ingestions: number;
      observations: number;
    }>(`
      select
        (select count(*)::int from department_ingestions) as ingestions,
        (select count(*)::int from seat_observations) as observations
    `);
    expect(counts.rows[0]).toEqual({ ingestions: 1, observations: 2 });
  });

  test("reconciles current data and records objective events with provenance", async () => {
    const createId = idSequence(
      firstIngestionId,
      secondIngestionId,
      "00000000-0000-4000-8000-000000000010",
      "00000000-0000-4000-8000-000000000011",
      "00000000-0000-4000-8000-000000000012",
      "00000000-0000-4000-8000-000000000013",
    );
    await persistDepartmentSnapshot(connection.db, baselineSnapshot(), {
      createId,
    });

    await expect(
      persistDepartmentSnapshot(connection.db, laterSnapshot(), { createId }),
    ).resolves.toEqual({
      ingestionId: secondIngestionId,
      previousIngestionId: firstIngestionId,
      alreadyPersisted: false,
      observationsInserted: 2,
      eventsInserted: 4,
    });

    const sections = await connection.pool.query<{
      section_id: string;
      is_active: boolean;
    }>("select section_id, is_active from sections order by section_id");
    expect(sections.rows).toEqual([
      { section_id: "CMSC498A-0101", is_active: true },
      { section_id: "CMSC498A-0201", is_active: false },
      { section_id: "CMSC498A-0301", is_active: true },
    ]);

    const eventRows = await connection.pool.query<{
      event_type: string;
      previous_ingestion_id: string;
      current_ingestion_id: string;
    }>(`
      select event_type, previous_ingestion_id, current_ingestion_id
      from seat_events order by event_type
    `);
    expect(eventRows.rows.map(({ event_type }) => event_type)).toEqual([
      "SECTION_ADDED",
      "SECTION_FILLED",
      "SECTION_REMOVED",
      "WAITLIST_CHANGED",
    ]);
    expect(
      eventRows.rows.every(
        (row) =>
          row.previous_ingestion_id === firstIngestionId &&
          row.current_ingestion_id === secondIngestionId,
      ),
    ).toBe(true);

    const currentMetadata = await connection.pool.query<{
      requirement: string;
      instructor: string;
      start_minutes: number;
    }>(`
      select r.label as requirement, i.name as instructor, m.start_minutes
      from course_requirements r
      join section_instructors i using (semester_code)
      join section_meetings m using (semester_code, section_id)
      where r.course_id = 'CMSC498A' and i.section_id = 'CMSC498A-0101'
    `);
    expect(currentMetadata.rows).toEqual([
      {
        requirement: "Recommended",
        instructor: "Katherine Johnson",
        start_minutes: 840,
      },
    ]);

    const observations = await connection.pool.query<{ count: number }>(
      "select count(*)::int as count from seat_observations",
    );
    expect(observations.rows[0]?.count).toBe(4);
  });

  test("rejects a same-key snapshot with different content", async () => {
    await persistDepartmentSnapshot(connection.db, baselineSnapshot(), {
      createId: () => firstIngestionId,
    });
    const conflicting = baselineSnapshot();
    conflicting.courses[0]!.title = "Changed title";

    await expect(
      persistDepartmentSnapshot(connection.db, conflicting),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_COLLISION" });
  });

  test("rejects an out-of-order snapshot", async () => {
    await persistDepartmentSnapshot(connection.db, baselineSnapshot(), {
      createId: () => firstIngestionId,
    });
    const older = baselineSnapshot();
    older.collectedAt = "2026-08-29T11:59:00.000Z";

    await expect(
      persistDepartmentSnapshot(connection.db, older),
    ).rejects.toMatchObject({ code: "OUT_OF_ORDER_SNAPSHOT" });
  });

  test("rejects a partial snapshot before writing", async () => {
    const partial = baselineSnapshot();
    partial.status = "partial";

    await expect(
      persistDepartmentSnapshot(connection.db, partial),
    ).rejects.toMatchObject({ code: "PARTIAL_SNAPSHOT" });

    const result = await connection.pool.query<{ count: number }>(
      "select count(*)::int as count from semesters",
    );
    expect(result.rows[0]?.count).toBe(0);
  });

  test("rolls back parent writes when an observation violates a constraint", async () => {
    const invalid = baselineSnapshot();
    invalid.courses[0]!.sections[0]!.seats.open = -1;

    await expect(
      persistDepartmentSnapshot(connection.db, invalid, {
        createId: () => firstIngestionId,
      }),
    ).rejects.toMatchObject({
      code: "PERSISTENCE_FAILED",
      message: "Database ingestion failed",
    });

    const counts = await connection.pool.query<{
      semesters: number;
      ingestions: number;
      courses: number;
      heads: number;
    }>(`
      select
        (select count(*)::int from semesters) as semesters,
        (select count(*)::int from department_ingestions) as ingestions,
        (select count(*)::int from courses) as courses,
        (select count(*)::int from department_ingestion_heads) as heads
    `);
    expect(counts.rows[0]).toEqual({
      semesters: 0,
      ingestions: 0,
      courses: 0,
      heads: 0,
    });
  });
});
