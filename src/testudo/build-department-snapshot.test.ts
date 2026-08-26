import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  buildDepartmentSnapshot,
  DepartmentSnapshotError,
} from "./build-department-snapshot.js";

const fixture = readFileSync(
  new URL("./fixtures/cmsc-202608-department.html", import.meta.url),
  "utf8",
);

const input = {
  html: fixture,
  semester: "202608",
  department: "CMSC",
  collectedAt: "2026-08-26T06:58:12.345Z",
  sourceUrl: "https://app.testudo.umd.edu/soc/202608/CMSC",
};

describe("buildDepartmentSnapshot", () => {
  it("parses courses and their nested sections in display order", () => {
    const snapshot = buildDepartmentSnapshot(input);

    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      semester: "202608",
      department: "CMSC",
      collectedAt: "2026-08-26T06:58:12.345Z",
      status: "complete",
      summary: {
        coursesFound: 2,
        coursesParsed: 2,
        coursesFailed: 0,
        sectionsParsed: 2,
      },
    });
    expect(snapshot.courses.map((course) => course.id)).toEqual([
      "CMSC131",
      "CMSC132",
    ]);
    expect(snapshot.courses[0]?.sections[0]?.id).toBe("CMSC131-0101");
  });

  it("records a malformed course and keeps valid siblings", () => {
    const html = fixture.replace(
      '<span class="course-title">Object-Oriented Programming II</span>',
      "",
    );
    const snapshot = buildDepartmentSnapshot({ ...input, html });

    expect(snapshot.status).toBe("partial");
    expect(snapshot.courses.map((course) => course.id)).toEqual(["CMSC131"]);
    expect(snapshot.summary).toMatchObject({
      coursesFound: 2,
      coursesParsed: 1,
      coursesFailed: 1,
      sectionsParsed: 1,
    });
    expect(snapshot.failures).toEqual([
      {
        courseId: "CMSC132",
        code: "COURSE_TITLE_MISSING",
        message: "course title is missing",
      },
    ]);
  });

  it("associates section warnings with their course", () => {
    const html = fixture.replace(
      '<span class="total-seats-count">32</span>',
      '<span class="total-seats-count">unknown</span>',
    );
    const snapshot = buildDepartmentSnapshot({ ...input, html });

    expect(snapshot.warnings).toContainEqual(
      expect.objectContaining({
        courseId: "CMSC131",
        code: "SECTION_SKIPPED",
        field: "section.seats.total",
      }),
    );
  });

  it.each([
    ["<html></html>", "NO_COURSES_FOUND"],
    [
      fixture.replace(/<span class="course-title">[^<]+<\/span>/g, ""),
      "NO_COURSES_PARSED",
    ],
  ])("rejects unusable department HTML with %s", (html, code) => {
    expect(() => buildDepartmentSnapshot({ ...input, html })).toThrowError(
      expect.objectContaining({ code }),
    );
    expect(() => buildDepartmentSnapshot({ ...input, html })).toThrowError(
      DepartmentSnapshotError,
    );
  });
});
