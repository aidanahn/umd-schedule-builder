import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseCoursePage } from "./parse-course-page.js";

function readFixture(name: string): string {
  return readFileSync(new URL(name, import.meta.url), "utf8");
}

describe("parseCoursePage course metadata", () => {
  it("keeps normal approved metadata and description behavior", () => {
    const course = parseCoursePage({
      html: readFixture("./fixtures/cmsc131-202608.html"),
      semester: "202608",
    }).course;

    expect(course.description).toBe(
      "Introduction to programming and computer science.",
    );
    expect(course.requirements).toEqual([
      { label: "Corequisite", text: "MATH140." },
      {
        label: "Credit only granted for",
        text: "CMSC131, CMSC133 or CMSC141.",
      },
    ]);
  });

  it("parses special-topics metadata from course text", () => {
    const course = parseCoursePage({
      html: readFixture("./fixtures/course-metadata/cmsc818j.html"),
      semester: "202608",
    }).course;

    expect(course.description).toBe(
      "Explores the design and implementation of modern computer systems.",
    );
    expect(course.requirements).toEqual([
      { label: "Cross-listed with", text: "ENEE759C." },
      {
        label: "Credit only granted for",
        text: "CMSC818J or ENEE759C.",
      },
      {
        label: "Restriction",
        text:
          "Must be in the Graduate Program in Computer Science. All other graduate students must request permission.",
      },
    ]);
    expect(course.sections.map((section) => section.id)).toEqual([
      "CMSC818J-0101",
    ]);
  });

  it("keeps genuinely absent course metadata empty", () => {
    const course = parseCoursePage({
      html: readFixture("./fixtures/course-metadata/cmsc298a.html"),
      semester: "202608",
    }).course;

    expect(course.description).toBeNull();
    expect(course.requirements).toEqual([]);
    expect(course.sections).toEqual([]);
  });

  it("does not treat a prose colon as a metadata label", () => {
    const html = `
      <div class="course" id="CMSC848P">
        <span class="course-id">CMSC848P</span>
        <span class="course-title">Advanced Topics in Learning Theory</span>
        <span class="course-min-credits">3</span>
        <div class="course-text">
          Machine learning theory asks questions such as: What guarantees can
          we prove for practical ML methods? This lecture-based course studies
          foundational tools in learning theory.
        </div>
      </div>
    `;

    const course = parseCoursePage({ html, semester: "202608" }).course;

    expect(course.description).toBe(
      "Machine learning theory asks questions such as: What guarantees can we prove for practical ML methods? This lecture-based course studies foundational tools in learning theory.",
    );
    expect(course.requirements).toEqual([]);
  });

  it("uses one label classifier and deduplicates both sources in order", () => {
    const html = `
      <div class="course" id="CMSC400">
        <span class="course-id">CMSC400</span>
        <span class="course-title">Metadata Test Course</span>
        <span class="course-min-credits">3</span>
        <div class="approved-course-text">
          <div><strong>Corequisite:</strong> CMSC300.</div>
          <div><strong>Recommended:</strong> CMSC350.</div>
        </div>
        <div class="approved-course-text">Shared description.</div>
        <div class="course-text">
          Recommended: CMSC350.<br><br>
          Formerly: CMSC399.<br><br>
          Additional information: Bring a laptop.<br><br>
          Shared description.<br><br>
          A second description paragraph.
        </div>
      </div>
    `;

    const course = parseCoursePage({ html, semester: "202608" }).course;

    expect(course.requirements).toEqual([
      { label: "Corequisite", text: "CMSC300." },
      { label: "Recommended", text: "CMSC350." },
      { label: "Formerly", text: "CMSC399." },
      { label: "Additional information", text: "Bring a laptop." },
    ]);
    expect(course.description).toBe(
      "Shared description.\n\nA second description paragraph.",
    );
  });
});
