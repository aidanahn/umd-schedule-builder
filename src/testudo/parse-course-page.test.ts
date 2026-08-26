import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  parseCoursePage,
  TestudoParseError,
} from "./parse-course-page.js";

const courseHtml = `
  <div class="course" id="CMSC298A">
    <div class="course-id"> CMSC298A </div>
    <span class="course-title">Special &amp; Selected Topics</span>
    <span class="course-min-credits">1</span>
    <span class="course-max-credits">4</span>
    <span class="grading-method">
      <abbr title="Regular">Reg</abbr>
      <abbr title="Pass-Fail">P-F</abbr>
      <abbr title="Regular">Reg</abbr>
    </span>
    <div class="gen-ed-codes-group">
      <span class="course-subcategory"><a>DSSP</a></span>
      <span class="course-subcategory"><a>SCIS</a></span>
    </div>
    <div class="approved-course-texts-container">
      <div class="approved-course-text">
        <div><strong>Prerequisite:</strong> CMSC216.</div>
        <div><strong>Restriction:</strong> Permission of department.</div>
      </div>
      <div class="approved-course-text">
        First paragraph &amp; details.
      </div>
      <div class="approved-course-text">Second paragraph.</div>
    </div>
  </div>
`;

const sectionHtml = `
  <div class="course" id="CMSC131">
    <div class="course-id">CMSC131</div>
    <span class="course-title">Object-Oriented Programming I</span>
    <span class="course-min-credits">4</span>
    <div class="sections-container">
      <div class="section delivery-f2f">
        <span class="section-id"> FC01 </span>
        <span class="section-instructor">Ada Lovelace</span>
        <span class="section-instructor"> Grace Hopper </span>
        <span class="section-instructor">Ada Lovelace</span>
        <span class="total-seats-count">32</span>
        <span class="open-seats-count">4</span>
        <span class="waitlist-count">3</span>
        <span class="holdfile-count">7</span>
        <div class="class-days-container">
          <div class="row">
            <span class="section-days">MWF</span>
            <span class="class-start-time">10:00am</span>
            <span class="class-end-time">10:50am</span>
            <span class="building-code">IRB</span>
            <span class="class-room">0324</span>
          </div>
          <div class="row">
            <span class="section-days">TuTh</span>
            <span class="class-start-time">12:00pm</span>
            <span class="class-end-time">1:15pm</span>
            <span class="class-type">Discussion</span>
          </div>
          <div class="row"><span class="layout-only">Spacer</span></div>
        </div>
        <div class="section-texts-container">
          <div class="section-text">
            Restricted to students in Freshmen Connection.
          </div>
          <div class="section-text">Bring your own laptop &amp; charger.</div>
        </div>
      </div>
      <div class="section delivery-online">
        <span class="section-id">0201</span>
        <span class="total-seats-count">40</span>
        <span class="open-seats-count">10</span>
      </div>
    </div>
  </div>
`;

const cmsc131Fixture = readFileSync(
  new URL("./fixtures/cmsc131-202608.html", import.meta.url),
  "utf8",
);

describe("parseCoursePage", () => {
  it("parses normalized course metadata", () => {
    const result = parseCoursePage({
      html: courseHtml,
      semester: "202608",
      sourceUrl: "https://app.testudo.umd.edu/soc/202608/CMSC/CMSC298A",
    });

    expect(result).toEqual({
      semester: "202608",
      course: {
        id: "CMSC298A",
        department: "CMSC",
        title: "Special & Selected Topics",
        credits: { min: 1, max: 4 },
        gradingMethods: ["Regular", "Pass-Fail"],
        genEdCodes: ["DSSP", "SCIS"],
        description: "First paragraph & details.\n\nSecond paragraph.",
        requirements: [
          { label: "Prerequisite", text: "CMSC216." },
          { label: "Restriction", text: "Permission of department." },
        ],
        sections: [],
      },
      warnings: [],
    });
  });

  it("uses the minimum credit value when no maximum is displayed", () => {
    const html = courseHtml.replace(
      '<span class="course-max-credits">4</span>',
      "",
    );

    expect(
      parseCoursePage({ html, semester: "202608" }).course.credits,
    ).toEqual({ min: 1, max: 1 });
  });

  it.each([
    [{ html: "", semester: "202608" }, "INVALID_INPUT"],
    [{ html: courseHtml, semester: "fall-2026" }, "INVALID_INPUT"],
    [
      { html: courseHtml.replace(/CMSC298A/g, ""), semester: "202608" },
      "COURSE_ID_MISSING",
    ],
    [
      {
        html: courseHtml.replace("Special &amp; Selected Topics", ""),
        semester: "202608",
      },
      "COURSE_TITLE_MISSING",
    ],
    [
      {
        html: courseHtml.replace(
          '<span class="course-min-credits">1</span>',
          '<span class="course-min-credits">many</span>',
        ),
        semester: "202608",
      },
      "CREDITS_INVALID",
    ],
    [
      { html: "<html>maintenance</html>", semester: "202608" },
      "PAGE_NOT_RECOGNIZED",
    ],
  ])("throws a typed course-level error %#", (input, code) => {
    let thrown: unknown;

    try {
      parseCoursePage(input);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TestudoParseError);
    expect(thrown).toMatchObject({ code });
  });
});

describe("parseCoursePage sections", () => {
  it("parses section identity, seats, instructors, delivery, and notes", () => {
    const result = parseCoursePage({ html: sectionHtml, semester: "202608" });

    expect(result.course.sections[0]).toEqual({
      id: "CMSC131-FC01",
      number: "FC01",
      instructors: ["Ada Lovelace", "Grace Hopper"],
      deliveryMode: "face-to-face",
      notes: [
        "Restricted to students in Freshmen Connection.",
        "Bring your own laptop & charger.",
      ],
      seats: { total: 32, open: 4, waitlist: 3, holdFile: 7 },
      meetings: [
        {
          days: ["M", "W", "F"],
          startMinutes: 600,
          endMinutes: 650,
          displayTime: "10:00am - 10:50am",
          building: "IRB",
          room: "0324",
          type: null,
        },
        {
          days: ["Tu", "Th"],
          startMinutes: 720,
          endMinutes: 795,
          displayTime: "12:00pm - 1:15pm",
          building: null,
          room: null,
          type: "Discussion",
        },
      ],
    });
    expect(result.warnings).toEqual([]);
  });

  it("uses null for absent waitlist and hold-file markup", () => {
    expect(
      parseCoursePage({ html: sectionHtml, semester: "202608" }).course
        .sections[1]?.seats,
    ).toEqual({ total: 40, open: 10, waitlist: null, holdFile: null });
  });

  it.each([
    ["delivery-f2f", "face-to-face"],
    ["delivery-blended", "blended"],
    ["delivery-online", "online"],
    ["delivery-hybrid", "unknown"],
  ] as const)("maps %s to %s", (className, expected) => {
    const html = sectionHtml.replace("delivery-f2f", className);
    const section = parseCoursePage({ html, semester: "202608" }).course
      .sections[0];

    expect(section?.deliveryMode).toBe(expected);
  });

  it.each([
    ['<span class="total-seats-count">32</span>', "section.seats.total"],
    ['<span class="open-seats-count">4</span>', "section.seats.open"],
    ['<span class="waitlist-count">3</span>', "section.seats.waitlist"],
    ['<span class="holdfile-count">7</span>', "section.seats.holdFile"],
  ])("skips only the section with malformed %s", (markup, field) => {
    const html = sectionHtml.replace(markup, markup.replace(/>[^<]*</, ">bad<"));
    const result = parseCoursePage({ html, semester: "202608" });

    expect(result.course.sections.map((section) => section.number)).toEqual([
      "0201",
    ]);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: "SECTION_SKIPPED",
        field,
        sectionNumber: "FC01",
        sectionIndex: 0,
      }),
    ]);
  });

  it("skips a section with an invalid ID and keeps its sibling", () => {
    const html = sectionHtml.replace(" FC01 ", " BAD ");
    const result = parseCoursePage({ html, semester: "202608" });

    expect(result.course.sections.map((section) => section.number)).toEqual([
      "0201",
    ]);
    expect(result.warnings[0]).toMatchObject({
      code: "SECTION_SKIPPED",
      field: "section.number",
      sectionNumber: "BAD",
      sectionIndex: 0,
    });
  });

  it("skips a section with no ID and keeps its sibling", () => {
    const html = sectionHtml.replace(
      '<span class="section-id"> FC01 </span>',
      "",
    );
    const result = parseCoursePage({ html, semester: "202608" });

    expect(result.course.sections).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      code: "SECTION_SKIPPED",
      field: "section.number",
      sectionNumber: null,
      sectionIndex: 0,
    });
  });
});

describe("parseCoursePage meetings", () => {
  it("normalizes meeting days, times, locations, and types", () => {
    const meetings = parseCoursePage({
      html: sectionHtml,
      semester: "202608",
    }).course.sections[0]?.meetings;

    expect(meetings).toEqual([
      {
        days: ["M", "W", "F"],
        startMinutes: 600,
        endMinutes: 650,
        displayTime: "10:00am - 10:50am",
        building: "IRB",
        room: "0324",
        type: null,
      },
      {
        days: ["Tu", "Th"],
        startMinutes: 720,
        endMinutes: 795,
        displayTime: "12:00pm - 1:15pm",
        building: null,
        room: null,
        type: "Discussion",
      },
    ]);
  });

  it.each([
    ["12:00am", 0],
    ["12:00pm", 720],
    ["1:05pm", 785],
  ])("normalizes the %s boundary", (displayed, minutes) => {
    const html = sectionHtml
      .replace("10:00am", displayed)
      .replace("10:50am", displayed);
    const meeting = parseCoursePage({ html, semester: "202608" }).course
      .sections[0]?.meetings[0];

    expect(meeting?.startMinutes).toBe(minutes);
    expect(meeting?.endMinutes).toBe(minutes);
  });

  it("normalizes weekend day codes", () => {
    const html = sectionHtml.replace("MWF", "SaSu");
    const meeting = parseCoursePage({ html, semester: "202608" }).course
      .sections[0]?.meetings[0];

    expect(meeting?.days).toEqual(["Sa", "Su"]);
  });

  it("keeps an explicitly unscheduled meeting nullable", () => {
    const html = sectionHtml.replace(
      /<span class="section-days">MWF<\/span>[\s\S]*?<span class="class-end-time">10:50am<\/span>/,
      '<span class="section-days">TBA</span>',
    );
    const meeting = parseCoursePage({ html, semester: "202608" }).course
      .sections[0]?.meetings[0];

    expect(meeting).toMatchObject({
      days: [],
      startMinutes: null,
      endMinutes: null,
      displayTime: null,
    });
  });

  it.each([
    ["MX", "meeting.days"],
    ["25:00pm", "meeting.time"],
  ])("skips only a malformed meeting containing %s", (value, field) => {
    const html = sectionHtml.replace(
      value === "MX" ? "MWF" : "10:00am",
      value,
    );
    const result = parseCoursePage({ html, semester: "202608" });

    expect(result.course.sections[0]?.meetings).toHaveLength(1);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: "MEETING_SKIPPED",
        field,
        sectionNumber: "FC01",
        sectionIndex: 0,
      }),
    );
  });

  it("skips a meeting with only one time boundary", () => {
    const html = sectionHtml.replace(
      '<span class="class-end-time">10:50am</span>',
      "",
    );
    const result = parseCoursePage({ html, semester: "202608" });

    expect(result.course.sections[0]?.meetings).toHaveLength(1);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: "MEETING_SKIPPED",
        field: "meeting.time",
      }),
    );
  });
});

describe("parseCoursePage Testudo fixture", () => {
  it("parses the trimmed CMSC131 page", () => {
    const result = parseCoursePage({
      html: cmsc131Fixture,
      semester: "202608",
    });

    expect(result.course.id).toBe("CMSC131");
    expect(result.course.sections).toHaveLength(2);
    expect(result.course.sections[0]).toMatchObject({
      id: "CMSC131-0101",
      meetings: [
        { days: ["M", "W", "F"], startMinutes: 600, endMinutes: 650 },
        {
          days: ["M", "W"],
          startMinutes: 660,
          endMinutes: 710,
          type: "Discussion",
        },
      ],
    });
    expect(result.course.sections[1]).toMatchObject({
      id: "CMSC131-FC01",
      notes: ["Restricted to students in Freshmen Connection."],
      seats: { holdFile: 6 },
    });
    expect(result.warnings).toEqual([]);
  });
});
