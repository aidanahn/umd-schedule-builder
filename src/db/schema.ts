import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import type { DepartmentSnapshot } from "../testudo/build-department-snapshot.js";
import type { SnapshotComparisonEvent } from "../testudo/compare-department-snapshots.js";

export const semesters = pgTable(
  "semesters",
  {
    code: text().primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("semesters_code_check", sql`${table.code} ~ '^[0-9]{6}$'`),
  ],
);

export const departments = pgTable(
  "departments",
  {
    code: text().primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("departments_code_check", sql`${table.code} ~ '^[A-Z]{4}$'`),
  ],
);

export const departmentIngestions = pgTable(
  "department_ingestions",
  {
    id: uuid().primaryKey(),
    semesterCode: text("semester_code")
      .notNull()
      .references(() => semesters.code),
    departmentCode: text("department_code")
      .notNull()
      .references(() => departments.code),
    collectedAt: timestamp("collected_at", { withTimezone: true }).notNull(),
    sourceUrl: text("source_url").notNull(),
    status: text().$type<"complete">().notNull(),
    summary: jsonb().$type<DepartmentSnapshot["summary"]>().notNull(),
    warnings: jsonb().$type<DepartmentSnapshot["warnings"]>().notNull(),
    snapshot: jsonb().$type<DepartmentSnapshot>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("department_ingestions_snapshot_key").on(
      table.semesterCode,
      table.departmentCode,
      table.collectedAt,
    ),
    check(
      "department_ingestions_status_check",
      sql`${table.status} = 'complete'`,
    ),
    index("department_ingestions_department_collected_idx").on(
      table.semesterCode,
      table.departmentCode,
      table.collectedAt,
    ),
  ],
);

export const departmentIngestionHeads = pgTable(
  "department_ingestion_heads",
  {
    semesterCode: text("semester_code")
      .notNull()
      .references(() => semesters.code),
    departmentCode: text("department_code")
      .notNull()
      .references(() => departments.code),
    latestIngestionId: uuid("latest_ingestion_id").references(
      () => departmentIngestions.id,
      { onDelete: "set null" },
    ),
    latestCollectedAt: timestamp("latest_collected_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "department_ingestion_heads_pk",
      columns: [table.semesterCode, table.departmentCode],
    }),
    check(
      "department_ingestion_heads_latest_pair_check",
      sql`(${table.latestIngestionId} is null) = (${table.latestCollectedAt} is null)`,
    ),
  ],
);

export const courses = pgTable(
  "courses",
  {
    semesterCode: text("semester_code")
      .notNull()
      .references(() => semesters.code),
    courseId: text("course_id").notNull(),
    departmentCode: text("department_code")
      .notNull()
      .references(() => departments.code),
    title: text().notNull(),
    creditsMin: numeric("credits_min", {
      precision: 6,
      scale: 2,
      mode: "number",
    }).notNull(),
    creditsMax: numeric("credits_max", {
      precision: 6,
      scale: 2,
      mode: "number",
    }).notNull(),
    gradingMethods: text("grading_methods").array().notNull(),
    genEdCodes: text("gen_ed_codes").array().notNull(),
    description: text(),
    isActive: boolean("is_active").notNull().default(true),
    lastSeenIngestionId: uuid("last_seen_ingestion_id")
      .notNull()
      .references(() => departmentIngestions.id),
  },
  (table) => [
    primaryKey({
      name: "courses_pk",
      columns: [table.semesterCode, table.courseId],
    }),
    check(
      "courses_credit_order_check",
      sql`${table.creditsMin} >= 0 and ${table.creditsMax} >= ${table.creditsMin}`,
    ),
    index("courses_active_department_idx").on(
      table.semesterCode,
      table.departmentCode,
      table.isActive,
    ),
    index("courses_course_id_idx").on(table.courseId),
  ],
);

export const courseRequirements = pgTable(
  "course_requirements",
  {
    semesterCode: text("semester_code").notNull(),
    courseId: text("course_id").notNull(),
    position: integer().notNull(),
    label: text().notNull(),
    text: text().notNull(),
  },
  (table) => [
    primaryKey({
      name: "course_requirements_pk",
      columns: [table.semesterCode, table.courseId, table.position],
    }),
    foreignKey({
      name: "course_requirements_course_fk",
      columns: [table.semesterCode, table.courseId],
      foreignColumns: [courses.semesterCode, courses.courseId],
    }).onDelete("cascade"),
    check("course_requirements_position_check", sql`${table.position} >= 0`),
  ],
);

export const sections = pgTable(
  "sections",
  {
    semesterCode: text("semester_code").notNull(),
    sectionId: text("section_id").notNull(),
    courseId: text("course_id").notNull(),
    sectionNumber: text("section_number").notNull(),
    deliveryMode: text("delivery_mode")
      .$type<"face-to-face" | "blended" | "online" | "unknown">()
      .notNull(),
    notes: text().array().notNull(),
    isActive: boolean("is_active").notNull().default(true),
    lastSeenIngestionId: uuid("last_seen_ingestion_id")
      .notNull()
      .references(() => departmentIngestions.id),
  },
  (table) => [
    primaryKey({
      name: "sections_pk",
      columns: [table.semesterCode, table.sectionId],
    }),
    foreignKey({
      name: "sections_course_fk",
      columns: [table.semesterCode, table.courseId],
      foreignColumns: [courses.semesterCode, courses.courseId],
    }),
    check(
      "sections_delivery_mode_check",
      sql`${table.deliveryMode} in ('face-to-face', 'blended', 'online', 'unknown')`,
    ),
    index("sections_active_course_idx").on(
      table.semesterCode,
      table.courseId,
      table.isActive,
    ),
    index("sections_section_id_idx").on(table.sectionId),
  ],
);

export const sectionInstructors = pgTable(
  "section_instructors",
  {
    semesterCode: text("semester_code").notNull(),
    sectionId: text("section_id").notNull(),
    position: integer().notNull(),
    name: text().notNull(),
  },
  (table) => [
    primaryKey({
      name: "section_instructors_pk",
      columns: [table.semesterCode, table.sectionId, table.position],
    }),
    foreignKey({
      name: "section_instructors_section_fk",
      columns: [table.semesterCode, table.sectionId],
      foreignColumns: [sections.semesterCode, sections.sectionId],
    }).onDelete("cascade"),
    check("section_instructors_position_check", sql`${table.position} >= 0`),
  ],
);

export const sectionMeetings = pgTable(
  "section_meetings",
  {
    semesterCode: text("semester_code").notNull(),
    sectionId: text("section_id").notNull(),
    position: integer().notNull(),
    days: text().array().notNull(),
    startMinutes: integer("start_minutes"),
    endMinutes: integer("end_minutes"),
    displayTime: text("display_time"),
    building: text(),
    room: text(),
    meetingType: text("meeting_type"),
  },
  (table) => [
    primaryKey({
      name: "section_meetings_pk",
      columns: [table.semesterCode, table.sectionId, table.position],
    }),
    foreignKey({
      name: "section_meetings_section_fk",
      columns: [table.semesterCode, table.sectionId],
      foreignColumns: [sections.semesterCode, sections.sectionId],
    }).onDelete("cascade"),
    check("section_meetings_position_check", sql`${table.position} >= 0`),
    check(
      "section_meetings_time_pair_check",
      sql`(${table.startMinutes} is null) = (${table.endMinutes} is null)`,
    ),
    check(
      "section_meetings_time_range_check",
      sql`${table.startMinutes} between 0 and 1439 and ${table.endMinutes} between ${table.startMinutes} and 1439`,
    ),
  ],
);

export const seatObservations = pgTable(
  "seat_observations",
  {
    ingestionId: uuid("ingestion_id")
      .notNull()
      .references(() => departmentIngestions.id, { onDelete: "cascade" }),
    semesterCode: text("semester_code").notNull(),
    sectionId: text("section_id").notNull(),
    courseId: text("course_id").notNull(),
    totalSeats: integer("total_seats").notNull(),
    openSeats: integer("open_seats").notNull(),
    waitlistCount: integer("waitlist_count"),
    holdFileCount: integer("hold_file_count"),
  },
  (table) => [
    primaryKey({
      name: "seat_observations_pk",
      columns: [table.ingestionId, table.semesterCode, table.sectionId],
    }),
    foreignKey({
      name: "seat_observations_section_fk",
      columns: [table.semesterCode, table.sectionId],
      foreignColumns: [sections.semesterCode, sections.sectionId],
    }),
    foreignKey({
      name: "seat_observations_course_fk",
      columns: [table.semesterCode, table.courseId],
      foreignColumns: [courses.semesterCode, courses.courseId],
    }),
    check(
      "seat_observations_counts_check",
      sql`${table.totalSeats} >= 0 and ${table.openSeats} >= 0 and (${table.waitlistCount} is null or ${table.waitlistCount} >= 0) and (${table.holdFileCount} is null or ${table.holdFileCount} >= 0)`,
    ),
    index("seat_observations_section_history_idx").on(
      table.semesterCode,
      table.sectionId,
      table.ingestionId,
    ),
  ],
);

export const seatEvents = pgTable(
  "seat_events",
  {
    id: uuid().primaryKey(),
    semesterCode: text("semester_code")
      .notNull()
      .references(() => semesters.code),
    departmentCode: text("department_code")
      .notNull()
      .references(() => departments.code),
    courseId: text("course_id").notNull(),
    sectionId: text("section_id").notNull(),
    sectionNumber: text("section_number").notNull(),
    eventType: text("event_type")
      .$type<SnapshotComparisonEvent["type"]>()
      .notNull(),
    previousIngestionId: uuid("previous_ingestion_id")
      .notNull()
      .references(() => departmentIngestions.id),
    currentIngestionId: uuid("current_ingestion_id")
      .notNull()
      .references(() => departmentIngestions.id),
    previousValue: jsonb("previous_value").$type<
      SnapshotComparisonEvent["previous"]
    >(),
    currentValue: jsonb("current_value").$type<
      SnapshotComparisonEvent["current"]
    >(),
    delta: integer(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "seat_events_section_fk",
      columns: [table.semesterCode, table.sectionId],
      foreignColumns: [sections.semesterCode, sections.sectionId],
    }),
    foreignKey({
      name: "seat_events_course_fk",
      columns: [table.semesterCode, table.courseId],
      foreignColumns: [courses.semesterCode, courses.courseId],
    }),
    unique("seat_events_current_section_type_key").on(
      table.currentIngestionId,
      table.sectionId,
      table.eventType,
    ),
    check(
      "seat_events_type_check",
      sql`${table.eventType} in ('SEATS_OPENED', 'SECTION_FILLED', 'OPEN_SEATS_CHANGED', 'TOTAL_SEATS_CHANGED', 'WAITLIST_CHANGED', 'HOLD_FILE_CHANGED', 'SECTION_ADDED', 'SECTION_REMOVED')`,
    ),
    index("seat_events_section_created_idx").on(
      table.semesterCode,
      table.sectionId,
      table.createdAt,
    ),
    index("seat_events_type_created_idx").on(
      table.eventType,
      table.createdAt,
    ),
    index("seat_events_current_ingestion_idx").on(table.currentIngestionId),
  ],
);

export const schema = {
  semesters,
  departments,
  departmentIngestions,
  departmentIngestionHeads,
  courses,
  courseRequirements,
  sections,
  sectionInstructors,
  sectionMeetings,
  seatObservations,
  seatEvents,
};
