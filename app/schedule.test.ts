import { describe, expect, test } from "vitest";

import type { CourseListItem } from "../src/db/list-courses.js";
import {
  addScheduleSection,
  createScheduleSection,
  removeScheduleSection,
  scheduleSectionKey,
  type ScheduleSection,
} from "./schedule.js";

const course: CourseListItem = {
  id: "CMSC216",
  title: "Introduction to Computer Systems",
  credits: { min: 4, max: 4 },
  gradingMethods: ["Regular"],
  genEdCodes: [],
  description: "Computer systems fundamentals.",
  requirements: [],
  sections: [
    {
      id: "CMSC216-0101",
      number: "0101",
      deliveryMode: "face-to-face",
      notes: [],
      instructors: ["Ada Lovelace"],
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
      ],
      seats: { total: 30, open: 2, waitlist: null, holdFile: null },
    },
    {
      id: "CMSC216-0201",
      number: "0201",
      deliveryMode: "unknown",
      notes: [],
      instructors: [],
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
      seats: null,
    },
  ],
};

const firstSection: ScheduleSection = {
  semester: "202608",
  courseId: "CMSC216",
  courseTitle: "Introduction to Computer Systems",
  sectionId: "CMSC216-0101",
  sectionNumber: "0101",
  instructors: ["Ada Lovelace"],
  meetings: [
    {
      days: ["M", "W"],
      displayTime: "10:00am - 11:15am",
      building: "IRB",
      room: "0324",
      type: "Lecture",
    },
  ],
};

const secondSection: ScheduleSection = {
  semester: "202608",
  courseId: "CMSC216",
  courseTitle: "Introduction to Computer Systems",
  sectionId: "CMSC216-0201",
  sectionNumber: "0201",
  instructors: [],
  meetings: [
    {
      days: [],
      displayTime: null,
      building: null,
      room: null,
      type: null,
    },
  ],
};

describe("schedule model", () => {
  test("derives only the display data needed for a saved section", () => {
    expect(createScheduleSection("202608", course, course.sections[0]!)).toEqual(
      firstSection,
    );
  });

  test("preserves missing normalized display data", () => {
    expect(createScheduleSection("202608", course, course.sections[1]!)).toEqual(
      secondSection,
    );
  });

  test("uses semester, course, and section for stable identity", () => {
    expect(scheduleSectionKey(firstSection)).toBe(
      '["202608","CMSC216","CMSC216-0101"]',
    );
    expect(scheduleSectionKey(secondSection)).not.toBe(
      scheduleSectionKey(firstSection),
    );
  });
});

describe("schedule collection operations", () => {
  test("adds a section to an empty schedule", () => {
    expect(addScheduleSection([], firstSection)).toEqual([firstSection]);
  });

  test("does not add the exact same section twice", () => {
    expect(addScheduleSection([firstSection], firstSection)).toEqual([
      firstSection,
    ]);
  });

  test("keeps multiple sections of the same course in insertion order", () => {
    expect(addScheduleSection([firstSection], secondSection)).toEqual([
      firstSection,
      secondSection,
    ]);
  });

  test("removes only the section with the requested identity", () => {
    expect(
      removeScheduleSection(
        [firstSection, secondSection],
        scheduleSectionKey(firstSection),
      ),
    ).toEqual([secondSection]);
  });

  test("leaves sections intact when the requested identity is unknown", () => {
    expect(
      removeScheduleSection([firstSection, secondSection], "unknown"),
    ).toEqual([firstSection, secondSection]);
  });
});
