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
  it("merges Testudo's bulk section response into matching courses", () => {
    const departmentHtml = `
      <div class="course" id="CMSC131">
        <span class="course-id">CMSC131</span>
        <span class="course-title">Object-Oriented Programming I</span>
        <span class="course-min-credits">4</span>
        <fieldset class="sections-fieldset sections-not-loaded"></fieldset>
      </div>
    `;
    const sectionsHtml = `
      <div class="course-sections" id="CMSC131">
        <div class="sections-container">
          <div class="section delivery-f2f">
            <span class="section-id">0101</span>
            <span class="total-seats-count">32</span>
            <span class="open-seats-count">2</span>
          </div>
        </div>
      </div>
    `;

    const snapshot = buildDepartmentSnapshot({
      ...input,
      html: departmentHtml,
      sectionsHtml,
    });

    expect(snapshot.summary.sectionsParsed).toBe(1);
    expect(snapshot.courses[0]?.sections[0]?.id).toBe("CMSC131-0101");
  });

  it("keeps a course with no offered sections when no wrapper is returned", () => {
    const snapshot = buildDepartmentSnapshot({
      ...input,
      html: `
        <div class="course" id="CMSC132">
          <span class="course-id">CMSC132</span>
          <span class="course-title">Object-Oriented Programming II</span>
          <span class="course-min-credits">4</span>
        </div>
      `,
      sectionsHtml: "<div></div>",
    });

    expect(snapshot.status).toBe("complete");
    expect(snapshot.courses[0]).toMatchObject({ id: "CMSC132", sections: [] });
    expect(snapshot.failures).toEqual([]);
  });

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
