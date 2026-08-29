import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";

import type { DepartmentSnapshot } from "../testudo/build-department-snapshot.js";
import { compareDepartmentSnapshots } from "../testudo/compare-department-snapshots.js";
import type { AppDatabase } from "./connection.js";
import {
  courseRequirements,
  courses,
  departmentIngestionHeads,
  departmentIngestions,
  departments,
  seatEvents,
  seatObservations,
  sectionInstructors,
  sectionMeetings,
  sections,
  semesters,
} from "./schema.js";
import {
  mapSeatEventRecords,
  mapSnapshotRecords,
  SnapshotPersistenceError,
  validatePersistableSnapshot,
} from "./snapshot-records.js";

export type PersistDepartmentSnapshotResult = {
  ingestionId: string;
  previousIngestionId: string | null;
  alreadyPersisted: boolean;
  observationsInserted: number;
  eventsInserted: number;
};

export type PersistDepartmentSnapshotOptions = {
  createId?: () => string;
};

export async function persistDepartmentSnapshot(
  db: AppDatabase,
  snapshot: DepartmentSnapshot,
  options: PersistDepartmentSnapshotOptions = {},
): Promise<PersistDepartmentSnapshotResult> {
  validatePersistableSnapshot(snapshot);
  const collectedAt = new Date(snapshot.collectedAt);
  const createId = options.createId ?? randomUUID;

  try {
    return await db.transaction(async (tx) => {
      await tx
        .insert(semesters)
        .values({ code: snapshot.semester })
        .onConflictDoNothing();
      await tx
        .insert(departments)
        .values({ code: snapshot.department })
        .onConflictDoNothing();
      await tx
        .insert(departmentIngestionHeads)
        .values({
          semesterCode: snapshot.semester,
          departmentCode: snapshot.department,
        })
        .onConflictDoNothing();

      await tx.execute(sql`
        select 1
        from ${departmentIngestionHeads}
        where ${departmentIngestionHeads.semesterCode} = ${snapshot.semester}
          and ${departmentIngestionHeads.departmentCode} = ${snapshot.department}
        for update
      `);

      const [head] = await tx
        .select()
        .from(departmentIngestionHeads)
        .where(
          and(
            eq(departmentIngestionHeads.semesterCode, snapshot.semester),
            eq(departmentIngestionHeads.departmentCode, snapshot.department),
          ),
        );

      const [existing] = await tx
        .select({
          id: departmentIngestions.id,
          snapshot: departmentIngestions.snapshot,
          collectedAt: departmentIngestions.collectedAt,
        })
        .from(departmentIngestions)
        .where(
          and(
            eq(departmentIngestions.semesterCode, snapshot.semester),
            eq(departmentIngestions.departmentCode, snapshot.department),
            eq(departmentIngestions.collectedAt, collectedAt),
          ),
        );

      if (existing) {
        if (!isDeepStrictEqual(existing.snapshot, snapshot)) {
          throw new SnapshotPersistenceError(
            "IDEMPOTENCY_COLLISION",
            "An ingestion already exists for this collection time with different data",
          );
        }

        const [previous] = await tx
          .select({ id: departmentIngestions.id })
          .from(departmentIngestions)
          .where(
            and(
              eq(departmentIngestions.semesterCode, snapshot.semester),
              eq(departmentIngestions.departmentCode, snapshot.department),
              lt(departmentIngestions.collectedAt, existing.collectedAt),
            ),
          )
          .orderBy(desc(departmentIngestions.collectedAt))
          .limit(1);

        return {
          ingestionId: existing.id,
          previousIngestionId: previous?.id ?? null,
          alreadyPersisted: true,
          observationsInserted: 0,
          eventsInserted: 0,
        };
      }

      if (head?.latestCollectedAt && collectedAt <= head.latestCollectedAt) {
        throw new SnapshotPersistenceError(
          "OUT_OF_ORDER_SNAPSHOT",
          "Snapshot collection time must be later than the current ingestion",
        );
      }

      let previousSnapshot: DepartmentSnapshot | null = null;
      if (head?.latestIngestionId) {
        const [previous] = await tx
          .select({ snapshot: departmentIngestions.snapshot })
          .from(departmentIngestions)
          .where(eq(departmentIngestions.id, head.latestIngestionId));
        previousSnapshot = previous?.snapshot ?? null;
      }

      const ingestionId = createId();
      await tx.insert(departmentIngestions).values({
        id: ingestionId,
        semesterCode: snapshot.semester,
        departmentCode: snapshot.department,
        collectedAt,
        sourceUrl: snapshot.sourceUrl,
        status: "complete",
        summary: snapshot.summary,
        warnings: snapshot.warnings,
        snapshot,
      });

      const records = mapSnapshotRecords(snapshot, ingestionId);
      const departmentCourseIds = tx
        .select({ courseId: courses.courseId })
        .from(courses)
        .where(
          and(
            eq(courses.semesterCode, snapshot.semester),
            eq(courses.departmentCode, snapshot.department),
          ),
        );

      await tx
        .update(sections)
        .set({ isActive: false })
        .where(
          and(
            eq(sections.semesterCode, snapshot.semester),
            inArray(sections.courseId, departmentCourseIds),
            eq(sections.isActive, true),
          ),
        );
      await tx
        .update(courses)
        .set({ isActive: false })
        .where(
          and(
            eq(courses.semesterCode, snapshot.semester),
            eq(courses.departmentCode, snapshot.department),
            eq(courses.isActive, true),
          ),
        );

      if (records.courses.length > 0) {
        await tx
          .insert(courses)
          .values(records.courses)
          .onConflictDoUpdate({
            target: [courses.semesterCode, courses.courseId],
            set: {
              departmentCode: sql`excluded.department_code`,
              title: sql`excluded.title`,
              creditsMin: sql`excluded.credits_min`,
              creditsMax: sql`excluded.credits_max`,
              gradingMethods: sql`excluded.grading_methods`,
              genEdCodes: sql`excluded.gen_ed_codes`,
              description: sql`excluded.description`,
              isActive: true,
              lastSeenIngestionId: ingestionId,
            },
          });

        const seenCourseIds = records.courses.map(({ courseId }) => courseId);
        await tx.delete(courseRequirements).where(
          and(
            eq(courseRequirements.semesterCode, snapshot.semester),
            inArray(courseRequirements.courseId, seenCourseIds),
          ),
        );
        if (records.requirements.length > 0) {
          await tx.insert(courseRequirements).values(records.requirements);
        }
      }

      if (records.sections.length > 0) {
        await tx
          .insert(sections)
          .values(records.sections)
          .onConflictDoUpdate({
            target: [sections.semesterCode, sections.sectionId],
            set: {
              courseId: sql`excluded.course_id`,
              sectionNumber: sql`excluded.section_number`,
              deliveryMode: sql`excluded.delivery_mode`,
              notes: sql`excluded.notes`,
              isActive: true,
              lastSeenIngestionId: ingestionId,
            },
          });

        const seenSectionIds = records.sections.map(({ sectionId }) => sectionId);
        const seenSectionCondition = and(
          eq(sectionInstructors.semesterCode, snapshot.semester),
          inArray(sectionInstructors.sectionId, seenSectionIds),
        );
        await tx.delete(sectionInstructors).where(seenSectionCondition);
        await tx.delete(sectionMeetings).where(
          and(
            eq(sectionMeetings.semesterCode, snapshot.semester),
            inArray(sectionMeetings.sectionId, seenSectionIds),
          ),
        );

        if (records.instructors.length > 0) {
          await tx.insert(sectionInstructors).values(records.instructors);
        }
        if (records.meetings.length > 0) {
          await tx.insert(sectionMeetings).values(records.meetings);
        }
      }

      if (records.observations.length > 0) {
        await tx.insert(seatObservations).values(records.observations);
      }

      let eventsInserted = 0;
      if (previousSnapshot && head?.latestIngestionId) {
        const comparison = compareDepartmentSnapshots(previousSnapshot, snapshot);
        const eventRecords = mapSeatEventRecords(
          comparison,
          head.latestIngestionId,
          ingestionId,
          createId,
        );
        if (eventRecords.length > 0) {
          await tx.insert(seatEvents).values(eventRecords);
        }
        eventsInserted = eventRecords.length;
      }

      await tx
        .update(departmentIngestionHeads)
        .set({
          latestIngestionId: ingestionId,
          latestCollectedAt: collectedAt,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(departmentIngestionHeads.semesterCode, snapshot.semester),
            eq(departmentIngestionHeads.departmentCode, snapshot.department),
          ),
        );

      return {
        ingestionId,
        previousIngestionId: head?.latestIngestionId ?? null,
        alreadyPersisted: false,
        observationsInserted: records.observations.length,
        eventsInserted,
      };
    });
  } catch (error) {
    if (error instanceof SnapshotPersistenceError) {
      throw error;
    }

    throw new SnapshotPersistenceError(
      "PERSISTENCE_FAILED",
      "Database ingestion failed",
      { cause: error },
    );
  }
}
