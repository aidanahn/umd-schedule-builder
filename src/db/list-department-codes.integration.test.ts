import "dotenv/config";

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createDatabaseConnection,
  type DatabaseConnection,
} from "./connection.js";
import { listDepartmentCodes } from "./list-department-codes.js";
import { assertTestDatabaseUrl } from "./test-database-url.js";

const describeDatabase =
  process.env.RUN_DB_TESTS === "true" ? describe : describe.skip;

describeDatabase("listDepartmentCodes", () => {
  let connection: DatabaseConnection;

  beforeAll(async () => {
    connection = createDatabaseConnection({
      connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL),
    });
    await connection.pool.query("drop schema if exists drizzle cascade");
    await connection.pool.query("drop schema public cascade");
    await connection.pool.query("create schema public");
    await migrate(connection.db, { migrationsFolder: "./drizzle" });
    await connection.pool.query(`
      insert into semesters (code) values ('202608'), ('202701');
      insert into departments (code) values ('CMSC'), ('ENGL'), ('MATH'), ('PHYS');
      insert into department_ingestions (
        id, semester_code, department_code, collected_at, source_url,
        status, summary, warnings, snapshot
      ) values
        ('10000000-0000-4000-8000-000000000001', '202608', 'CMSC', now(), 'https://example.test', 'complete', '{}', '[]', '{}'),
        ('10000000-0000-4000-8000-000000000002', '202608', 'ENGL', now(), 'https://example.test', 'complete', '{}', '[]', '{}'),
        ('10000000-0000-4000-8000-000000000003', '202608', 'MATH', now(), 'https://example.test', 'complete', '{}', '[]', '{}'),
        ('10000000-0000-4000-8000-000000000004', '202608', 'PHYS', now(), 'https://example.test', 'complete', '{}', '[]', '{}');
      insert into courses (
        semester_code, course_id, department_code, title, credits_min,
        credits_max, grading_methods, gen_ed_codes, description, is_active,
        last_seen_ingestion_id
      ) values
        ('202608', 'CMSC131', 'CMSC', 'Programming I', 4, 4, '{}', '{}', null, true, '10000000-0000-4000-8000-000000000001'),
        ('202608', 'CMSC132', 'CMSC', 'Programming II', 4, 4, '{}', '{}', null, true, '10000000-0000-4000-8000-000000000001'),
        ('202608', 'ENGL101', 'ENGL', 'Academic Writing', 3, 3, '{}', '{}', null, true, '10000000-0000-4000-8000-000000000002'),
        ('202608', 'MATH140', 'MATH', 'Calculus I', 4, 4, '{}', '{}', null, true, '10000000-0000-4000-8000-000000000003'),
        ('202608', 'PHYS161', 'PHYS', 'Physics I', 3, 3, '{}', '{}', null, false, '10000000-0000-4000-8000-000000000004');
    `);
  });

  afterAll(async () => connection?.close());

  it("returns distinct active department codes alphabetically", async () => {
    await expect(
      listDepartmentCodes(connection.db, { semester: "202608" }),
    ).resolves.toEqual(["CMSC", "ENGL", "MATH"]);
  });
});
