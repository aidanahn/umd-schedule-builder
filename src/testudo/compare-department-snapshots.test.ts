import { describe, expect, it } from "vitest";

import type { DepartmentSnapshot } from "./build-department-snapshot.js";
import { compareDepartmentSnapshots } from "./compare-department-snapshots.js";
import type { Section } from "./parse-course-page.js";

type TestSection = {
  courseId: string;
  number: string;
  seats: Section["seats"];
};

function snapshot(
  collectedAt: string,
  sections: TestSection[],
  overrides: Partial<DepartmentSnapshot> = {},
): DepartmentSnapshot {
  const courseIds = [...new Set(sections.map((section) => section.courseId))];

  return {
    schemaVersion: 1,
    semester: "202608",
    department: "CMSC",
    collectedAt,
    sourceUrl: "https://app.testudo.umd.edu/soc/202608/CMSC",
    status: "complete",
    summary: {
      coursesFound: courseIds.length,
      coursesParsed: courseIds.length,
      coursesFailed: 0,
      sectionsParsed: sections.length,
    },
    courses: courseIds.map((courseId) => ({
      id: courseId,
      department: "CMSC",
      title: `${courseId} test course`,
      credits: { min: 3, max: 3 },
      gradingMethods: [],
      genEdCodes: [],
      description: null,
      requirements: [],
      sections: sections
        .filter((section) => section.courseId === courseId)
        .map(({ number, seats }) => ({
          id: `${courseId}-${number}`,
          number,
          instructors: [],
          deliveryMode: "unknown",
          notes: [],
          seats,
          meetings: [],
        })),
    })),
    warnings: [],
    failures: [],
    ...overrides,
  };
}

const beforeTime = "2026-08-26T14:00:00.000Z";
const afterTime = "2026-08-26T14:05:00.000Z";

describe("compareDepartmentSnapshots", () => {
  it("reports objective seat changes in stable section order", () => {
    const before = snapshot(beforeTime, [
      {
        courseId: "CMSC216",
        number: "0301",
        seats: { total: 30, open: 8, waitlist: 0, holdFile: 0 },
      },
      {
        courseId: "CMSC132",
        number: "0201",
        seats: { total: 20, open: 2, waitlist: 0, holdFile: 0 },
      },
      {
        courseId: "CMSC131",
        number: "0101",
        seats: { total: 30, open: 0, waitlist: 2, holdFile: null },
      },
    ]);
    const after = snapshot(afterTime, [
      {
        courseId: "CMSC131",
        number: "0101",
        seats: { total: 30, open: 3, waitlist: 1, holdFile: 4 },
      },
      {
        courseId: "CMSC216",
        number: "0301",
        seats: { total: 30, open: 5, waitlist: 0, holdFile: 0 },
      },
      {
        courseId: "CMSC132",
        number: "0201",
        seats: { total: 22, open: 0, waitlist: 0, holdFile: 0 },
      },
    ]);

    expect(compareDepartmentSnapshots(before, after)).toEqual({
      schemaVersion: 1,
      semester: "202608",
      department: "CMSC",
      beforeCollectedAt: beforeTime,
      afterCollectedAt: afterTime,
      summary: { events: 6, sectionsChanged: 3 },
      events: [
        {
          type: "SEATS_OPENED",
          courseId: "CMSC131",
          sectionId: "CMSC131-0101",
          sectionNumber: "0101",
          previous: 0,
          current: 3,
          delta: 3,
        },
        {
          type: "WAITLIST_CHANGED",
          courseId: "CMSC131",
          sectionId: "CMSC131-0101",
          sectionNumber: "0101",
          previous: 2,
          current: 1,
          delta: -1,
        },
        {
          type: "HOLD_FILE_CHANGED",
          courseId: "CMSC131",
          sectionId: "CMSC131-0101",
          sectionNumber: "0101",
          previous: null,
          current: 4,
          delta: null,
        },
        {
          type: "SECTION_FILLED",
          courseId: "CMSC132",
          sectionId: "CMSC132-0201",
          sectionNumber: "0201",
          previous: 2,
          current: 0,
          delta: -2,
        },
        {
          type: "TOTAL_SEATS_CHANGED",
          courseId: "CMSC132",
          sectionId: "CMSC132-0201",
          sectionNumber: "0201",
          previous: 20,
          current: 22,
          delta: 2,
        },
        {
          type: "OPEN_SEATS_CHANGED",
          courseId: "CMSC216",
          sectionId: "CMSC216-0301",
          sectionNumber: "0301",
          previous: 8,
          current: 5,
          delta: -3,
        },
      ],
    });
  });

  it("reports added and removed sections without count-change noise", () => {
    const removedSeats = {
      total: 30,
      open: 4,
      waitlist: 1,
      holdFile: null,
    };
    const addedSeats = { total: 25, open: 2, waitlist: 0, holdFile: 3 };
    const before = snapshot(beforeTime, [
      { courseId: "CMSC131", number: "0101", seats: removedSeats },
    ]);
    const after = snapshot(afterTime, [
      { courseId: "CMSC132", number: "0201", seats: addedSeats },
    ]);

    expect(compareDepartmentSnapshots(before, after).events).toEqual([
      {
        type: "SECTION_REMOVED",
        courseId: "CMSC131",
        sectionId: "CMSC131-0101",
        sectionNumber: "0101",
        previous: removedSeats,
        current: null,
        delta: null,
      },
      {
        type: "SECTION_ADDED",
        courseId: "CMSC132",
        sectionId: "CMSC132-0201",
        sectionNumber: "0201",
        previous: null,
        current: addedSeats,
        delta: null,
      },
    ]);
  });

  it("returns an empty report when seat data is unchanged", () => {
    const before = snapshot(beforeTime, [
      {
        courseId: "CMSC131",
        number: "0101",
        seats: { total: 30, open: 4, waitlist: null, holdFile: null },
      },
    ]);
    const after = snapshot(afterTime, [
      {
        courseId: "CMSC131",
        number: "0101",
        seats: { total: 30, open: 4, waitlist: null, holdFile: null },
      },
    ]);

    expect(compareDepartmentSnapshots(before, after)).toMatchObject({
      summary: { events: 0, sectionsChanged: 0 },
      events: [],
    });
  });

  it.each([
    [
      { status: "partial" as const },
      {},
      "both snapshots must be complete",
    ],
    [{}, { semester: "202701" }, "snapshot semesters must match"],
    [{}, { department: "MATH" }, "snapshot departments must match"],
  ])("rejects unsafe comparison input %#", (beforeOverrides, afterOverrides, message) => {
    const before = snapshot(beforeTime, [], beforeOverrides);
    const after = snapshot(afterTime, [], afterOverrides);

    expect(() => compareDepartmentSnapshots(before, after)).toThrow(message);
  });
});
