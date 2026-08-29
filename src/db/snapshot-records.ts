import type { DepartmentSnapshot } from "../testudo/build-department-snapshot.js";
import type { DepartmentSnapshotComparison } from "../testudo/compare-department-snapshots.js";
import {
  courseRequirements,
  courses,
  seatEvents,
  seatObservations,
  sectionInstructors,
  sectionMeetings,
  sections,
} from "./schema.js";

export type SnapshotPersistenceErrorCode =
  | "PARTIAL_SNAPSHOT"
  | "IDEMPOTENCY_COLLISION"
  | "OUT_OF_ORDER_SNAPSHOT"
  | "PERSISTENCE_FAILED";

export class SnapshotPersistenceError extends Error {
  constructor(
    public readonly code: SnapshotPersistenceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SnapshotPersistenceError";
  }
}

export function validatePersistableSnapshot(
  snapshot: DepartmentSnapshot,
): void {
  if (snapshot.status !== "complete") {
    throw new SnapshotPersistenceError(
      "PARTIAL_SNAPSHOT",
      "Only complete department snapshots can be persisted",
    );
  }
}

export type SnapshotRecords = {
  courses: (typeof courses.$inferInsert)[];
  requirements: (typeof courseRequirements.$inferInsert)[];
  sections: (typeof sections.$inferInsert)[];
  instructors: (typeof sectionInstructors.$inferInsert)[];
  meetings: (typeof sectionMeetings.$inferInsert)[];
  observations: (typeof seatObservations.$inferInsert)[];
};

export function mapSnapshotRecords(
  snapshot: DepartmentSnapshot,
  ingestionId: string,
): SnapshotRecords {
  const records: SnapshotRecords = {
    courses: [],
    requirements: [],
    sections: [],
    instructors: [],
    meetings: [],
    observations: [],
  };

  for (const course of snapshot.courses) {
    records.courses.push({
      semesterCode: snapshot.semester,
      courseId: course.id,
      departmentCode: snapshot.department,
      title: course.title,
      creditsMin: course.credits.min,
      creditsMax: course.credits.max,
      gradingMethods: [...course.gradingMethods],
      genEdCodes: [...course.genEdCodes],
      description: course.description,
      isActive: true,
      lastSeenIngestionId: ingestionId,
    });

    course.requirements.forEach((requirement, position) => {
      records.requirements.push({
        semesterCode: snapshot.semester,
        courseId: course.id,
        position,
        label: requirement.label,
        text: requirement.text,
      });
    });

    for (const section of course.sections) {
      records.sections.push({
        semesterCode: snapshot.semester,
        sectionId: section.id,
        courseId: course.id,
        sectionNumber: section.number,
        deliveryMode: section.deliveryMode,
        notes: [...section.notes],
        isActive: true,
        lastSeenIngestionId: ingestionId,
      });

      section.instructors.forEach((name, position) => {
        records.instructors.push({
          semesterCode: snapshot.semester,
          sectionId: section.id,
          position,
          name,
        });
      });

      section.meetings.forEach((meeting, position) => {
        records.meetings.push({
          semesterCode: snapshot.semester,
          sectionId: section.id,
          position,
          days: [...meeting.days],
          startMinutes: meeting.startMinutes,
          endMinutes: meeting.endMinutes,
          displayTime: meeting.displayTime,
          building: meeting.building,
          room: meeting.room,
          meetingType: meeting.type,
        });
      });

      records.observations.push({
        ingestionId,
        semesterCode: snapshot.semester,
        sectionId: section.id,
        courseId: course.id,
        totalSeats: section.seats.total,
        openSeats: section.seats.open,
        waitlistCount: section.seats.waitlist,
        holdFileCount: section.seats.holdFile,
      });
    }
  }

  return records;
}

export function mapSeatEventRecords(
  comparison: DepartmentSnapshotComparison,
  previousIngestionId: string,
  currentIngestionId: string,
  createId: () => string,
): (typeof seatEvents.$inferInsert)[] {
  return comparison.events.map((event) => ({
    id: createId(),
    semesterCode: comparison.semester,
    departmentCode: comparison.department,
    courseId: event.courseId,
    sectionId: event.sectionId,
    sectionNumber: event.sectionNumber,
    eventType: event.type,
    previousIngestionId,
    currentIngestionId,
    previousValue: event.previous,
    currentValue: event.current,
    delta: event.delta,
  }));
}
