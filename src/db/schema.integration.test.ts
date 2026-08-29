import "dotenv/config";

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  createDatabaseConnection,
  type DatabaseConnection,
} from "./connection.js";
import { assertTestDatabaseUrl } from "./test-database-url.js";

const describeDatabase =
  process.env.RUN_DB_TESTS === "true" ? describe : describe.skip;

describeDatabase("PostgreSQL schema", () => {
  let connection: DatabaseConnection;

  beforeAll(async () => {
    const connectionString = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);
    connection = createDatabaseConnection({ connectionString });

    await connection.pool.query("drop schema public cascade");
    await connection.pool.query("create schema public");
    await migrate(connection.db, { migrationsFolder: "./drizzle" });

    await connection.pool.query(
      `insert into semesters (code) values ('202608')`,
    );
    await connection.pool.query(
      `insert into departments (code) values ('CMSC')`,
    );
    await connection.pool.query(`
      insert into department_ingestions (
        id, semester_code, department_code, collected_at, source_url,
        status, summary, warnings, snapshot
      ) values (
        '00000000-0000-4000-8000-000000000001',
        '202608', 'CMSC', '2026-08-29T12:00:00Z', 'https://example.test',
        'complete', '{}', '[]', '{}'
      )
    `);
    await connection.pool.query(`
      insert into courses (
        semester_code, course_id, department_code, title, credits_min,
        credits_max, grading_methods, gen_ed_codes, description,
        last_seen_ingestion_id
      ) values (
        '202608', 'CMSC131', 'CMSC', 'Object-Oriented Programming I',
        4, 4, '{}', '{}', null,
        '00000000-0000-4000-8000-000000000001'
      )
    `);
    await connection.pool.query(`
      insert into sections (
        semester_code, section_id, course_id, section_number,
        delivery_mode, notes, last_seen_ingestion_id
      ) values (
        '202608', 'CMSC131-0101', 'CMSC131', '0101',
        'face-to-face', '{}',
        '00000000-0000-4000-8000-000000000001'
      )
    `);
  });

  afterAll(async () => {
    await connection?.close();
  });

  test("creates the complete catalog and history table set", async () => {
    const result = await connection.pool.query<{ table_name: string }>(`
      select table_name
      from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name
    `);

    expect(result.rows.map(({ table_name }) => table_name)).toEqual([
      "course_requirements",
      "courses",
      "department_ingestion_heads",
      "department_ingestions",
      "departments",
      "seat_events",
      "seat_observations",
      "section_instructors",
      "section_meetings",
      "sections",
      "semesters",
    ]);
  });

  test("rejects malformed semester and department codes", async () => {
    await expect(
      connection.pool.query(`insert into semesters (code) values ('20268')`),
    ).rejects.toMatchObject({ constraint: "semesters_code_check" });

    await expect(
      connection.pool.query(`insert into departments (code) values ('cmsc')`),
    ).rejects.toMatchObject({ constraint: "departments_code_check" });
  });

  test("rejects invalid meeting time ranges", async () => {
    await expect(
      connection.pool.query(`
        insert into section_meetings (
          semester_code, section_id, position, days, start_minutes, end_minutes
        ) values ('202608', 'CMSC131-0101', 0, '{M}', 900, 800)
      `),
    ).rejects.toMatchObject({
      constraint: "section_meetings_time_range_check",
    });
  });

  test("rejects negative seat counts", async () => {
    await expect(
      connection.pool.query(`
        insert into seat_observations (
          ingestion_id, semester_code, section_id, course_id,
          total_seats, open_seats, waitlist_count, hold_file_count
        ) values (
          '00000000-0000-4000-8000-000000000001',
          '202608', 'CMSC131-0101', 'CMSC131', 30, -1, null, null
        )
      `),
    ).rejects.toMatchObject({ constraint: "seat_observations_counts_check" });
  });
});
