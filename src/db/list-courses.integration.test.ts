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
        ('00000000-0000-4000-8000-000000000004', '202608', 'CMSC', '2026-08-30T12:00:00Z', 'https://example.test/202608/CMSC', 'complete', '{}', '[]', '{}'),
        ('00000000-0000-4000-8000-000000000001', '202608', 'CMSC', '2026-08-31T12:00:00Z', 'https://example.test/202608/CMSC', 'complete', '{}', '[]', '{}'),
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

      insert into department_ingestion_heads (
        semester_code,
        department_code,
        latest_ingestion_id,
        latest_collected_at
      ) values (
        '202608',
        'CMSC',
        '00000000-0000-4000-8000-000000000001',
        '2026-08-31T12:00:00Z'
      ), (
        '202608',
        'MATH',
        '00000000-0000-4000-8000-000000000002',
        '2026-08-31T12:00:00Z'
      );

      insert into course_requirements (
        semester_code, course_id, position, label, text
      ) values
        ('202608', 'CMSC216', 1, 'Restriction', 'Permission of the department.'),
        ('202608', 'CMSC216', 0, 'Prerequisite', 'CMSC132.');

      insert into sections (
        semester_code,
        section_id,
        course_id,
        section_number,
        delivery_mode,
        notes,
        is_active,
        last_seen_ingestion_id
      ) values
        ('202608', 'CMSC216-0201', 'CMSC216', '0201', 'online', array[]::text[], true, '00000000-0000-4000-8000-000000000001'),
        ('202608', 'CMSC216-0101', 'CMSC216', '0101', 'face-to-face', array['Restricted to majors.'], true, '00000000-0000-4000-8000-000000000001'),
        ('202608', 'CMSC216-0301', 'CMSC216', '0301', 'blended', array[]::text[], false, '00000000-0000-4000-8000-000000000001');

      insert into section_instructors (
        semester_code, section_id, position, name
      ) values
        ('202608', 'CMSC216-0101', 1, 'Grace Hopper'),
        ('202608', 'CMSC216-0101', 0, 'Ada Lovelace');

      insert into section_meetings (
        semester_code,
        section_id,
        position,
        days,
        start_minutes,
        end_minutes,
        display_time,
        building,
        room,
        meeting_type
      ) values
        ('202608', 'CMSC216-0101', 1, array['F'], 720, 770, '12:00pm - 12:50pm', null, null, 'Discussion'),
        ('202608', 'CMSC216-0101', 0, array['M', 'W'], 600, 675, '10:00am - 11:15am', 'IRB', '0324', 'Lecture');

      insert into seat_observations (
        ingestion_id,
        semester_code,
        section_id,
        course_id,
        total_seats,
        open_seats,
        waitlist_count,
        hold_file_count
      ) values
        ('00000000-0000-4000-8000-000000000004', '202608', 'CMSC216-0101', 'CMSC216', 30, 9, 2, 7),
        ('00000000-0000-4000-8000-000000000001', '202608', 'CMSC216-0101', 'CMSC216', 30, 2, null, 5);
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
        requirements: [],
        sections: [],
      },
      {
        id: "CMSC216",
        title: "Introduction to Computer Systems",
        credits: { min: 4, max: 4 },
        gradingMethods: ["Regular"],
        genEdCodes: [],
        description: "Computer systems fundamentals.",
        requirements: [
          { label: "Prerequisite", text: "CMSC132." },
          { label: "Restriction", text: "Permission of the department." },
        ],
        sections: [
          {
            id: "CMSC216-0101",
            number: "0101",
            deliveryMode: "face-to-face",
            notes: ["Restricted to majors."],
            instructors: ["Ada Lovelace", "Grace Hopper"],
            meetings: [
              {
                days: ["M", "W"],
                startMinutes: 600,
                endMinutes: 675,
                displayTime: "10:00am - 11:15am",
                building: "IRB",
                room: "0324",
                type: "Lecture",
              },
              {
                days: ["F"],
                startMinutes: 720,
                endMinutes: 770,
                displayTime: "12:00pm - 12:50pm",
                building: null,
                room: null,
                type: "Discussion",
              },
            ],
            seats: {
              total: 30,
              open: 2,
              waitlist: null,
              holdFile: 5,
            },
          },
          {
            id: "CMSC216-0201",
            number: "0201",
            deliveryMode: "online",
            notes: [],
            instructors: [],
            meetings: [],
            seats: null,
          },
        ],
      },
    ]);
  });

  test("matches a trimmed course ID without regard to case", async () => {
    const results = await listCourses(connection.db, {
      semester: "202608",
      department: "CMSC",
      query: "  cmsc216  ",
    });

    expect(results.map(({ id }) => id)).toEqual(["CMSC216"]);
  });

  test("searches every active department when department is omitted", async () => {
    const results = await listCourses(connection.db, {
      semester: "202608",
      query: "calculus",
    });

    expect(results.map(({ id }) => id)).toEqual(["MATH140"]);
  });

  test("limits global results deterministically", async () => {
    const results = await listCourses(connection.db, {
      semester: "202608",
      query: "",
      limit: 2,
    });

    expect(results.map(({ id }) => id)).toEqual(["CMSC131", "CMSC216"]);
  });

  test("matches a title substring without regard to case", async () => {
    const results = await listCourses(connection.db, {
      semester: "202608",
      department: "CMSC",
      query: "OBJECT-oriented",
    });

    expect(results.map(({ id }) => id)).toEqual(["CMSC131"]);
  });

  test("treats a blank query as an unfiltered course listing", async () => {
    const results = await listCourses(connection.db, {
      semester: "202608",
      department: "CMSC",
      query: "   ",
    });

    expect(results.map(({ id }) => id)).toEqual(["CMSC131", "CMSC216"]);
  });

  test("treats SQL wildcard characters as literal search text", async () => {
    await connection.pool.query(`
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
      ) values (
        '202608',
        'CMSC389A',
        'CMSC',
        'Topics: 100% Reliable Systems',
        3,
        3,
        array['Regular'],
        array[]::text[],
        null,
        true,
        '00000000-0000-4000-8000-000000000001'
      )
    `);

    const results = await listCourses(connection.db, {
      semester: "202608",
      department: "CMSC",
      query: "%",
    });

    expect(results.map(({ id }) => id)).toEqual(["CMSC389A"]);
  });
});
