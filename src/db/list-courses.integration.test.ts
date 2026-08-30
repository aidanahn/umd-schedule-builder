import "dotenv/config";

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import {
  createDatabaseConnection,
  type DatabaseConnection,
} from "./connection.js";
import { listCourses } from "./list-courses.js";
import { assertTestDatabaseUrl } from "./test-database-url.js";

const describeDatabase =
  process.env.RUN_DB_TESTS === "true" ? describe : describe.skip;

describeDatabase("listCourses", () => {
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

    await connection.pool.query(`
      insert into semesters (code) values ('202608'), ('202701');
      insert into departments (code) values ('CMSC'), ('MATH');

      insert into department_ingestions (
        id,
        semester_code,
        department_code,
        collected_at,
        source_url,
        status,
        summary,
        warnings,
        snapshot
      ) values
        ('00000000-0000-4000-8000-000000000001', '202608', 'CMSC', now(), 'https://example.test/202608/CMSC', 'complete', '{}', '[]', '{}'),
        ('00000000-0000-4000-8000-000000000002', '202608', 'MATH', now(), 'https://example.test/202608/MATH', 'complete', '{}', '[]', '{}'),
        ('00000000-0000-4000-8000-000000000003', '202701', 'CMSC', now(), 'https://example.test/202701/CMSC', 'complete', '{}', '[]', '{}');

      insert into courses (
        semester_code,
        course_id,
        department_code,
        title,
        credits_min,
        credits_max,
        grading_methods,
        gen_ed_codes,
        description,
        is_active,
        last_seen_ingestion_id
      ) values
        ('202608', 'CMSC216', 'CMSC', 'Introduction to Computer Systems', 4, 4, array['Regular'], array[]::text[], 'Computer systems fundamentals.', true, '00000000-0000-4000-8000-000000000001'),
        ('202608', 'CMSC131', 'CMSC', 'Object-Oriented Programming I', 4, 4, array['Regular', 'Pass-Fail'], array['FSAR'], null, true, '00000000-0000-4000-8000-000000000001'),
        ('202608', 'CMSC250', 'CMSC', 'Discrete Structures', 4, 4, array['Regular'], array[]::text[], 'Inactive course.', false, '00000000-0000-4000-8000-000000000001'),
        ('202608', 'MATH140', 'MATH', 'Calculus I', 4, 4, array['Regular'], array['FSMA'], 'Differential calculus.', true, '00000000-0000-4000-8000-000000000002'),
        ('202701', 'CMSC131', 'CMSC', 'Object-Oriented Programming I', 4, 4, array['Regular'], array[]::text[], 'A later semester.', true, '00000000-0000-4000-8000-000000000003');
    `);
  });

  afterAll(async () => {
    await connection?.close();
  });

  test("returns active courses for one semester and department in course ID order", async () => {
    await expect(
      listCourses(connection.db, {
        semester: "202608",
        department: "CMSC",
      }),
    ).resolves.toEqual([
      {
        id: "CMSC131",
        title: "Object-Oriented Programming I",
        credits: { min: 4, max: 4 },
        gradingMethods: ["Regular", "Pass-Fail"],
        genEdCodes: ["FSAR"],
        description: null,
      },
      {
        id: "CMSC216",
        title: "Introduction to Computer Systems",
        credits: { min: 4, max: 4 },
        gradingMethods: ["Regular"],
        genEdCodes: [],
        description: "Computer systems fundamentals.",
      },
    ]);
  });
});
