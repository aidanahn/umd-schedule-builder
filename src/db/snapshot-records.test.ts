import { describe, expect, test } from "vitest";

import type { DepartmentSnapshot } from "../testudo/build-department-snapshot.js";
import type { DepartmentSnapshotComparison } from "../testudo/compare-department-snapshots.js";
import {
  mapSeatEventRecords,
  mapSnapshotRecords,
  SnapshotPersistenceError,
  validatePersistableSnapshot,
} from "./snapshot-records.js";

const snapshot = {
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
    sectionsParsed: 1,
  },
  courses: [
    {
      id: "CMSC498A",
      department: "CMSC",
      title: "Selected Topics in Computer Science",
      credits: { min: 1, max: 3 },
      gradingMethods: ["Regular", "Pass-Fail"],
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
          deliveryMode: "blended",
          notes: ["Seats reserved for majors."],
          seats: {
            total: 25,
            open: 4,
            waitlist: null,
            holdFile: 2,
          },
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
} satisfies DepartmentSnapshot;

const ingestionId = "00000000-0000-4000-8000-000000000001";

describe("validatePersistableSnapshot", () => {
  test("rejects a partial snapshot", () => {
    const partial = { ...snapshot, status: "partial" as const };

    expect(() => validatePersistableSnapshot(partial)).toThrowError(
      expect.objectContaining({
        name: "SnapshotPersistenceError",
        code: "PARTIAL_SNAPSHOT",
      }),
    );
  });

  test("accepts a complete snapshot", () => {
    expect(() => validatePersistableSnapshot(snapshot)).not.toThrow();
  });
});

describe("mapSnapshotRecords", () => {
  test("preserves ordered and nullable snapshot data", () => {
    const records = mapSnapshotRecords(snapshot, ingestionId);

    expect(records.courses).toEqual([
      {
        semesterCode: "202608",
        courseId: "CMSC498A",
        departmentCode: "CMSC",
        title: "Selected Topics in Computer Science",
        creditsMin: 1,
        creditsMax: 3,
        gradingMethods: ["Regular", "Pass-Fail"],
        genEdCodes: [],
        description: "An advanced selected-topics course.",
        isActive: true,
        lastSeenIngestionId: ingestionId,
      },
    ]);
    expect(records.requirements).toEqual([
      {
        semesterCode: "202608",
        courseId: "CMSC498A",
        position: 0,
        label: "Prerequisite",
        text: "CMSC330.",
      },
      {
        semesterCode: "202608",
        courseId: "CMSC498A",
        position: 1,
        label: "Restriction",
        text: "Permission of department.",
      },
    ]);
    expect(records.sections).toEqual([
      {
        semesterCode: "202608",
        sectionId: "CMSC498A-0101",
        courseId: "CMSC498A",
        sectionNumber: "0101",
        deliveryMode: "blended",
        notes: ["Seats reserved for majors."],
        isActive: true,
        lastSeenIngestionId: ingestionId,
      },
    ]);
    expect(records.instructors).toEqual([
      {
        semesterCode: "202608",
        sectionId: "CMSC498A-0101",
        position: 0,
        name: "Ada Lovelace",
      },
      {
        semesterCode: "202608",
        sectionId: "CMSC498A-0101",
        position: 1,
        name: "Grace Hopper",
      },
    ]);
    expect(records.meetings).toEqual([
      {
        semesterCode: "202608",
        sectionId: "CMSC498A-0101",
        position: 0,
        days: ["M", "W"],
        startMinutes: 600,
        endMinutes: 675,
        displayTime: "10:00am - 11:15am",
        building: "IRB",
        room: "1207",
        meetingType: "Lecture",
      },
      {
        semesterCode: "202608",
        sectionId: "CMSC498A-0101",
        position: 1,
        days: [],
        startMinutes: null,
        endMinutes: null,
        displayTime: null,
        building: null,
        room: null,
        meetingType: null,
      },
    ]);
    expect(records.observations).toEqual([
      {
        ingestionId,
        semesterCode: "202608",
        sectionId: "CMSC498A-0101",
        courseId: "CMSC498A",
        totalSeats: 25,
        openSeats: 4,
        waitlistCount: null,
        holdFileCount: 2,
      },
    ]);
    expect(records.courses[0]?.gradingMethods).not.toBe(
      snapshot.courses[0]?.gradingMethods,
    );
    expect(records.sections[0]?.notes).not.toBe(
      snapshot.courses[0]?.sections[0]?.notes,
    );
  });
});

describe("mapSeatEventRecords", () => {
  test("maps numeric and section-presence events with ingestion provenance", () => {
    const comparison = {
      schemaVersion: 1,
      semester: "202608",
      department: "CMSC",
      beforeCollectedAt: "2026-08-29T12:00:00.000Z",
      afterCollectedAt: "2026-08-29T12:05:00.000Z",
      summary: { events: 2, sectionsChanged: 2 },
      events: [
        {
          type: "OPEN_SEATS_CHANGED",
          courseId: "CMSC498A",
          sectionId: "CMSC498A-0101",
          sectionNumber: "0101",
          previous: 4,
          current: 2,
          delta: -2,
        },
        {
          type: "SECTION_ADDED",
          courseId: "CMSC498A",
          sectionId: "CMSC498A-0201",
          sectionNumber: "0201",
          previous: null,
          current: { total: 20, open: 3, waitlist: null, holdFile: 0 },
          delta: null,
        },
      ],
    } satisfies DepartmentSnapshotComparison;
    const ids = [
      "00000000-0000-4000-8000-000000000010",
      "00000000-0000-4000-8000-000000000011",
    ];

    const records = mapSeatEventRecords(
      comparison,
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
      () => ids.shift()!,
    );

    expect(records).toEqual([
      {
        id: "00000000-0000-4000-8000-000000000010",
        semesterCode: "202608",
        departmentCode: "CMSC",
        courseId: "CMSC498A",
        sectionId: "CMSC498A-0101",
        sectionNumber: "0101",
        eventType: "OPEN_SEATS_CHANGED",
        previousIngestionId:
          "00000000-0000-4000-8000-000000000001",
        currentIngestionId: "00000000-0000-4000-8000-000000000002",
        previousValue: 4,
        currentValue: 2,
        delta: -2,
      },
      {
        id: "00000000-0000-4000-8000-000000000011",
        semesterCode: "202608",
        departmentCode: "CMSC",
        courseId: "CMSC498A",
        sectionId: "CMSC498A-0201",
        sectionNumber: "0201",
        eventType: "SECTION_ADDED",
        previousIngestionId:
          "00000000-0000-4000-8000-000000000001",
        currentIngestionId: "00000000-0000-4000-8000-000000000002",
        previousValue: null,
        currentValue: { total: 20, open: 3, waitlist: null, holdFile: 0 },
        delta: null,
      },
    ]);
  });
});

test("SnapshotPersistenceError exposes its stable code", () => {
  const error = new SnapshotPersistenceError(
    "OUT_OF_ORDER_SNAPSHOT",
    "Snapshot is older than the current ingestion",
  );

  expect(error).toMatchObject({
    name: "SnapshotPersistenceError",
    code: "OUT_OF_ORDER_SNAPSHOT",
    message: "Snapshot is older than the current ingestion",
  });
});
