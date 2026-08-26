# Testudo Course Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse one Testudo course-detail page into typed course, section, seat, note, and normalized meeting data while recovering from malformed individual sections and meetings.

**Architecture:** `parseCoursePage` is a synchronous, pure Cheerio-based parser. Course-level identity failures throw a typed error; each section and meeting is parsed inside its own recovery boundary so valid siblings remain available with structured warnings.

**Tech Stack:** Node.js 20+, TypeScript 5, Cheerio 1.2, Vitest

**Spec:** `docs/superpowers/specs/2026-08-25-testudo-course-parser-design.md`

## Global Constraints

- Parse one course-detail HTML document per call.
- Require a six-digit semester, nonblank HTML, a valid course ID, a title, and valid credits.
- Require every returned section to have a section number, total seats, and open seats.
- Missing waitlist or hold-file markup maps to `null`, not zero.
- Preserve section-specific `.section-text` values as opaque strings in display order.
- Normalize day codes and 12-hour meeting times to minutes after midnight while retaining `displayTime`.
- Skip malformed individual sections and meetings with structured warnings whenever the course itself remains usable.
- Keep the parser synchronous and free of network, filesystem, logging, and global-state behavior.
- Default tests make no external requests.

## File Map

- `package.json`: add Cheerio and run both opt-in integration tests from the live-test script.
- `package-lock.json`: lock Cheerio and its transitive dependencies.
- `src/testudo/parse-course-page.ts`: public parser types, typed errors, DOM extraction, normalization, and recovery behavior.
- `src/testudo/parse-course-page.test.ts`: focused unit tests with small inline HTML documents.
- `src/testudo/fixtures/cmsc131-202608.html`: trimmed realistic Testudo structure containing ordinary and Freshmen Connection sections.
- `src/testudo/parse-course-page.integration.test.ts`: opt-in direct request and parse of the current CMSC131 detail page.

---

### Task 1: Course-Level Contract and Metadata

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/testudo/parse-course-page.ts`
- Test: `src/testudo/parse-course-page.test.ts`

**Interfaces:**
- Consumes: an HTML string, six-digit semester, and optional source URL.
- Produces: `parseCoursePage(input): ParseCoursePageResult`, the approved model types, and `TestudoParseError`.

- [ ] **Step 1: Install Cheerio as the only new runtime dependency**

Run: `npm install cheerio@^1.2.0`

Expected: `package.json` contains `"cheerio": "^1.2.0"` under `dependencies`; the lockfile updates; `npm audit` reports no known vulnerabilities.

- [ ] **Step 2: Write failing course metadata and input tests**

Create `src/testudo/parse-course-page.test.ts`:

```ts
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
    try {
      parseCoursePage(input);
      throw new Error("expected parseCoursePage to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(TestudoParseError);
      expect(error).toMatchObject({ code });
    }
  });
});
```

- [ ] **Step 3: Run the focused test and verify red**

Run: `npm test -- src/testudo/parse-course-page.test.ts`

Expected: FAIL because `parse-course-page.ts` does not exist.

- [ ] **Step 4: Define the approved public model and typed parse error**

Create `src/testudo/parse-course-page.ts` with these exported definitions:

```ts
import { load, type CheerioAPI } from "cheerio";

type Selection = ReturnType<CheerioAPI>;

export type CreditRange = { min: number; max: number };
export type LabeledText = { label: string; text: string };
export type DayCode = "M" | "Tu" | "W" | "Th" | "F" | "Sa" | "Su";

export type Meeting = {
  days: DayCode[];
  startMinutes: number | null;
  endMinutes: number | null;
  displayTime: string | null;
  building: string | null;
  room: string | null;
  type: string | null;
};

export type Section = {
  id: string;
  number: string;
  instructors: string[];
  deliveryMode: "face-to-face" | "blended" | "online" | "unknown";
  notes: string[];
  seats: {
    total: number;
    open: number;
    waitlist: number | null;
    holdFile: number | null;
  };
  meetings: Meeting[];
};

export type Course = {
  id: string;
  department: string;
  title: string;
  credits: CreditRange;
  gradingMethods: string[];
  genEdCodes: string[];
  description: string | null;
  requirements: LabeledText[];
  sections: Section[];
};

export type ParseWarning = {
  code: "SECTION_SKIPPED" | "MEETING_SKIPPED" | "OPTIONAL_FIELD_INVALID";
  message: string;
  field: string;
  sectionNumber: string | null;
  sectionIndex: number | null;
};

export type ParseCoursePageInput = {
  html: string;
  semester: string;
  sourceUrl?: string;
};

export type ParseCoursePageResult = {
  semester: string;
  course: Course;
  warnings: ParseWarning[];
};

export type TestudoParseErrorCode =
  | "INVALID_INPUT"
  | "COURSE_ID_MISSING"
  | "COURSE_TITLE_MISSING"
  | "CREDITS_INVALID"
  | "PAGE_NOT_RECOGNIZED";

export class TestudoParseError extends Error {
  constructor(
    public readonly code: TestudoParseErrorCode,
    message: string,
    public readonly metadata: Readonly<{
      field?: string;
      sourceUrl?: string;
    }> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "TestudoParseError";
  }
}
```

- [ ] **Step 5: Implement normalized course extraction**

Add these helpers and the initial parser. Keep `sections: []` until Task 2.

```ts
function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function parseCredit(value: string): number | undefined {
  const normalized = cleanText(value);
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return undefined;
  return Number(normalized);
}

function errorMetadata(input: ParseCoursePageInput, field: string) {
  return input.sourceUrl
    ? { field, sourceUrl: input.sourceUrl }
    : { field };
}

function parseApprovedText($: CheerioAPI, course: Selection) {
  const descriptionParts: string[] = [];
  const requirements: LabeledText[] = [];

  course.find(".approved-course-text").each((_index, element) => {
    const block = $(element);
    const labels = block.find("strong");

    if (labels.length === 0) {
      const text = cleanText(block.text());
      if (text) descriptionParts.push(text);
      return;
    }

    labels.each((_labelIndex, labelElement) => {
      const labelNode = $(labelElement);
      const displayedLabel = cleanText(labelNode.text());
      const label = displayedLabel.replace(/:$/, "");
      const parentText = cleanText(labelNode.parent().text());
      const text = cleanText(parentText.slice(displayedLabel.length));
      if (label && text) requirements.push({ label, text });
    });
  });

  return {
    description:
      descriptionParts.length > 0 ? descriptionParts.join("\n\n") : null,
    requirements,
  };
}

export function parseCoursePage(
  input: ParseCoursePageInput,
): ParseCoursePageResult {
  if (!/^\d{6}$/.test(input.semester) || input.html.trim().length === 0) {
    throw new TestudoParseError(
      "INVALID_INPUT",
      "semester must be six digits and html must not be blank",
      errorMetadata(input, "input"),
    );
  }

  const $ = load(input.html);
  const course = $(".course").first();
  if (course.length === 0) {
    throw new TestudoParseError(
      "PAGE_NOT_RECOGNIZED",
      "Testudo course container was not found",
      errorMetadata(input, "html"),
    );
  }

  const id = cleanText(course.find(".course-id").first().text()).toUpperCase();
  if (!/^[A-Z]{4}\d{3}[A-Z]?$/.test(id)) {
    throw new TestudoParseError(
      "COURSE_ID_MISSING",
      "course ID is missing or invalid",
      errorMetadata(input, "course.id"),
    );
  }

  const title = cleanText(course.find(".course-title").first().text());
  if (!title) {
    throw new TestudoParseError(
      "COURSE_TITLE_MISSING",
      "course title is missing",
      errorMetadata(input, "course.title"),
    );
  }

  const min = parseCredit(course.find(".course-min-credits").first().text());
  const maxText = course.find(".course-max-credits").first().text();
  const max = maxText ? parseCredit(maxText) : min;
  if (min === undefined || max === undefined || max < min) {
    throw new TestudoParseError(
      "CREDITS_INVALID",
      "course credits are missing or invalid",
      errorMetadata(input, "course.credits"),
    );
  }

  const gradingMethods = unique(
    course
      .find(".grading-method abbr[title]")
      .map((_index, element) => cleanText($(element).attr("title") ?? ""))
      .get(),
  );
  const genEdCodes = unique(
    course
      .find(".gen-ed-codes-group .course-subcategory a")
      .map((_index, element) => cleanText($(element).text()))
      .get(),
  );
  const approvedText = parseApprovedText($, course);

  return {
    semester: input.semester,
    course: {
      id,
      department: id.slice(0, 4),
      title,
      credits: { min, max },
      gradingMethods,
      genEdCodes,
      description: approvedText.description,
      requirements: approvedText.requirements,
      sections: [],
    },
    warnings: [],
  };
}
```

- [ ] **Step 6: Run course tests and type checking**

Run: `npm test -- src/testudo/parse-course-page.test.ts && npm run typecheck`

Expected: all course metadata/input tests PASS and TypeScript reports no errors.

- [ ] **Step 7: Commit course parsing**

```bash
git add package.json package-lock.json src/testudo/parse-course-page.ts src/testudo/parse-course-page.test.ts
git commit -m "Parse Testudo course metadata"
```

---

### Task 2: Sections, Seats, Hold File, and Notes

**Files:**
- Modify: `src/testudo/parse-course-page.ts`
- Test: `src/testudo/parse-course-page.test.ts`

**Interfaces:**
- Consumes: Task 1 course model and scoped Cheerio course element.
- Produces: valid `Section[]`, including nullable waitlist/hold-file values and opaque section notes, plus `SECTION_SKIPPED` warnings.

- [ ] **Step 1: Add failing valid-section and optional-seat tests**

Append a `sectionHtml` fixture and these tests:

```ts
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
    meetings: [],
  });
  expect(result.warnings).toEqual([]);
});

it("uses null for absent waitlist and hold-file markup", () => {
  expect(
    parseCoursePage({ html: sectionHtml, semester: "202608" }).course
      .sections[1]?.seats,
  ).toEqual({ total: 40, open: 10, waitlist: null, holdFile: null });
});
```

- [ ] **Step 2: Add failing malformed-section recovery tests**

Append:

```ts
it.each([
  ["<span class=\"total-seats-count\">32</span>", "section.seats.total"],
  ["<span class=\"open-seats-count\">4</span>", "section.seats.open"],
  ["<span class=\"waitlist-count\">3</span>", "section.seats.waitlist"],
  ["<span class=\"holdfile-count\">7</span>", "section.seats.holdFile"],
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
      sectionIndex: 0,
    }),
  ]);
});
```

Add a separate invalid-format case because the fixture contains whitespace around the displayed ID:

```ts
it("skips a section with an invalid ID and keeps its sibling", () => {
  const html = sectionHtml.replace(" FC01 ", " BAD ");
  const result = parseCoursePage({ html, semester: "202608" });

  expect(result.course.sections.map((section) => section.number)).toEqual([
    "0201",
  ]);
  expect(result.warnings[0]).toMatchObject({
    code: "SECTION_SKIPPED",
    field: "section.number",
    sectionIndex: 0,
  });
});
```

Use a dedicated missing-ID case rather than replacing the ID text with `bad`, because `bad` tests invalid format while absence verifies the required-field branch:

```ts
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
```

- [ ] **Step 3: Run section tests and verify red**

Run: `npm test -- src/testudo/parse-course-page.test.ts`

Expected: Task 1 tests PASS; section tests FAIL because `sections` is still empty.

- [ ] **Step 4: Implement isolated section parsing**

Add an internal recoverable error and section helpers:

```ts
class RecordParseError extends Error {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "RecordParseError";
  }
}

function requiredCount(value: string, field: string): number {
  const normalized = cleanText(value);
  if (!/^\d+$/.test(normalized)) {
    throw new RecordParseError(field, `${field} is missing or invalid`);
  }
  return Number(normalized);
}

function optionalCount(
  exists: boolean,
  value: string,
  field: string,
): number | null {
  return exists ? requiredCount(value, field) : null;
}

function deliveryMode(classNames: string | undefined): Section["deliveryMode"] {
  const classes = new Set((classNames ?? "").split(/\s+/));
  if (classes.has("delivery-f2f")) return "face-to-face";
  if (classes.has("delivery-blended")) return "blended";
  if (classes.has("delivery-online")) return "online";
  return "unknown";
}
```

Implement `parseSection` using the scoped section node:

```ts
function parseSection(
  $: CheerioAPI,
  section: Selection,
  courseId: string,
): Section {
  const number = cleanText(section.find(".section-id").first().text()).toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(number)) {
    throw new RecordParseError(
      "section.number",
      "section number is missing or invalid",
    );
  }

  const waitlistNode = section.find(".waitlist-count").first();
  const holdFileNode = section.find(".holdfile-count").first();

  return {
    id: `${courseId}-${number}`,
    number,
    instructors: unique(
      section
        .find(".section-instructor")
        .map((_index, node) => cleanText($(node).text()))
        .get(),
    ),
    deliveryMode: deliveryMode(section.attr("class")),
    notes: unique(
      section
        .find(".section-texts-container .section-text")
        .map((_index, node) => cleanText($(node).text()))
        .get(),
    ),
    seats: {
      total: requiredCount(
        section.find(".total-seats-count").first().text(),
        "section.seats.total",
      ),
      open: requiredCount(
        section.find(".open-seats-count").first().text(),
        "section.seats.open",
      ),
      waitlist: optionalCount(
        waitlistNode.length > 0,
        waitlistNode.text(),
        "section.seats.waitlist",
      ),
      holdFile: optionalCount(
        holdFileNode.length > 0,
        holdFileNode.text(),
        "section.seats.holdFile",
      ),
    },
    meetings: [],
  };
}
```

In `parseCoursePage`, replace `sections: []` with a section loop and share the warnings array with the return value:

```ts
const warnings: ParseWarning[] = [];
const sections: Section[] = [];

course.find(".sections-container .section").each((sectionIndex, element) => {
  const sectionNumber = cleanText(
    $(element).find(".section-id").first().text(),
  ).toUpperCase() || null;

  try {
    sections.push(parseSection($, $(element), id));
  } catch (error) {
    if (!(error instanceof RecordParseError)) throw error;
    warnings.push({
      code: "SECTION_SKIPPED",
      message: error.message,
      field: error.field,
      sectionNumber,
      sectionIndex,
    });
  }
});
```

- [ ] **Step 5: Run section tests and type checking**

Run: `npm test -- src/testudo/parse-course-page.test.ts && npm run typecheck`

Expected: all Task 1 and Task 2 tests PASS.

- [ ] **Step 6: Commit section parsing**

```bash
git add src/testudo/parse-course-page.ts src/testudo/parse-course-page.test.ts
git commit -m "Parse Testudo sections and seats"
```

---

### Task 3: Normalized Meetings and Meeting-Level Recovery

**Files:**
- Modify: `src/testudo/parse-course-page.ts`
- Test: `src/testudo/parse-course-page.test.ts`

**Interfaces:**
- Consumes: the Task 2 section parser and its shared warning array.
- Produces: normalized `Meeting[]` and `MEETING_SKIPPED` warnings without dropping an otherwise valid section.

- [ ] **Step 1: Add failing meeting normalization tests**

Insert meeting rows into the first section in `sectionHtml`:

```html
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
</div>
```

Add assertions:

```ts
it("normalizes meeting days and times", () => {
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
```

- [ ] **Step 2: Add failing unscheduled and malformed-meeting tests**

Append:

```ts
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
```

- [ ] **Step 3: Run meeting tests and verify red**

Run: `npm test -- src/testudo/parse-course-page.test.ts`

Expected: Task 1 and Task 2 tests PASS; meeting assertions FAIL because `meetings` is still empty.

- [ ] **Step 4: Implement day and time normalization**

Add:

```ts
const DAY_CODES: DayCode[] = ["Tu", "Th", "Sa", "Su", "M", "W", "F"];

function parseDays(value: string): DayCode[] {
  const normalized = cleanText(value);
  if (!normalized || /^(?:TBA|ARR)$/i.test(normalized)) return [];

  const days: DayCode[] = [];
  let remaining = normalized;
  while (remaining) {
    const day = DAY_CODES.find((candidate) => remaining.startsWith(candidate));
    if (!day) {
      throw new RecordParseError("meeting.days", "meeting days are invalid");
    }
    days.push(day);
    remaining = remaining.slice(day.length);
  }
  return days;
}

function parseTime(value: string): number {
  const match = /^(\d{1,2}):([0-5]\d)(am|pm)$/i.exec(cleanText(value));
  if (!match) {
    throw new RecordParseError("meeting.time", "meeting time is invalid");
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 1 || hour > 12) {
    throw new RecordParseError("meeting.time", "meeting time is invalid");
  }

  return (hour % 12) * 60 + minute + (match[3]?.toLowerCase() === "pm" ? 720 : 0);
}
```

- [ ] **Step 5: Implement meeting parsing and recovery**

Add a scoped meeting parser:

```ts
function nullableText(value: string): string | null {
  const normalized = cleanText(value);
  return normalized || null;
}

function parseMeeting($: CheerioAPI, meeting: Selection): Meeting {
  const dayText = cleanText(meeting.find(".section-days").first().text());
  const startText = cleanText(meeting.find(".class-start-time").first().text());
  const endText = cleanText(meeting.find(".class-end-time").first().text());

  if (Boolean(startText) !== Boolean(endText)) {
    throw new RecordParseError(
      "meeting.time",
      "meeting must include both start and end times",
    );
  }

  return {
    days: parseDays(dayText),
    startMinutes: startText ? parseTime(startText) : null,
    endMinutes: endText ? parseTime(endText) : null,
    displayTime: startText ? `${startText} - ${endText}` : null,
    building: nullableText(meeting.find(".building-code").first().text()),
    room: nullableText(meeting.find(".class-room").first().text()),
    type: nullableText(meeting.find(".class-type").first().text()),
  };
}
```

Change the `parseSection` declaration from:

```ts
function parseSection(
  $: CheerioAPI,
  section: Selection,
  courseId: string,
): Section {
```

to:

```ts
function parseSection(
  $: CheerioAPI,
  section: Selection,
  courseId: string,
  warnings: ParseWarning[],
  sectionIndex: number,
): Section {
```

Before returning the section, parse rows independently. Ignore structural rows without meeting fields:

```ts
const meetings: Meeting[] = [];
const meetingSelector = [
  ".section-days",
  ".class-start-time",
  ".class-end-time",
  ".building-code",
  ".class-room",
  ".class-type",
].join(", ");

section.find(".class-days-container .row").each((_meetingIndex, element) => {
  const row = $(element);
  if (row.find(meetingSelector).length === 0) return;

  try {
    meetings.push(parseMeeting($, row));
  } catch (error) {
    if (!(error instanceof RecordParseError)) throw error;
    warnings.push({
      code: "MEETING_SKIPPED",
      message: error.message,
      field: error.field,
      sectionNumber: number,
      sectionIndex,
    });
  }
});
```

Set `meetings` on the returned section, then update the Task 2 caller:

```ts
sections.push(
  parseSection($, $(element), id, warnings, sectionIndex),
);
```

- [ ] **Step 6: Run meeting tests and type checking**

Run: `npm test -- src/testudo/parse-course-page.test.ts && npm run typecheck`

Expected: all parser unit tests PASS.

- [ ] **Step 7: Commit meeting normalization**

```bash
git add src/testudo/parse-course-page.ts src/testudo/parse-course-page.test.ts
git commit -m "Normalize Testudo meeting times"
```

---

### Task 4: Realistic Fixture and Opt-In Live Parsing

**Files:**
- Modify: `package.json`
- Create: `src/testudo/fixtures/cmsc131-202608.html`
- Modify: `src/testudo/parse-course-page.test.ts`
- Create: `src/testudo/parse-course-page.integration.test.ts`

**Interfaces:**
- Consumes: Task 3 `parseCoursePage` and the public CMSC131 course-detail URL.
- Produces: realistic offline selector coverage and `npm run test:live` coverage for both fetcher and parser integrations.

- [ ] **Step 1: Add a trimmed realistic CMSC131 fixture**

Create `src/testudo/fixtures/cmsc131-202608.html` from the inspected Testudo markup. Keep the nesting and class names but only include:

```html
<!doctype html>
<html>
  <body>
    <div id="CMSC131" class="course">
      <div class="course-id-container"><div class="course-id">CMSC131</div></div>
      <div class="course-info-container">
        <span class="course-title">Object-Oriented Programming I</span>
        <div class="course-credits-group">
          <span class="course-min-credits">4</span>
        </div>
        <span class="grading-method"><abbr title="Regular">Reg</abbr></span>
        <div class="approved-course-texts-container">
          <div class="approved-course-text">
            <div><strong>Corequisite:</strong> MATH140.</div>
            <div><strong>Credit only granted for:</strong> CMSC131, CMSC133 or CMSC141.</div>
          </div>
          <div class="approved-course-text">Introduction to programming and computer science.</div>
        </div>
        <div class="sections-container">
          <div class="section delivery-f2f">
            <span class="section-id">0101</span>
            <span class="section-instructor">Elias Gonzalez</span>
            <span class="total-seats-count">32</span>
            <span class="open-seats-count">0</span>
            <span class="waitlist-count">0</span>
            <div class="class-days-container">
              <div class="row">
                <span class="section-days">MWF</span>
                <span class="class-start-time">10:00am</span>
                <span class="class-end-time">10:50am</span>
                <span class="building-code">IRB</span>
                <span class="class-room">0324</span>
              </div>
              <div class="row">
                <span class="section-days">MW</span>
                <span class="class-start-time">11:00am</span>
                <span class="class-end-time">11:50am</span>
                <span class="building-code">CSI</span>
                <span class="class-room">2120</span>
                <span class="class-type">Discussion</span>
              </div>
            </div>
          </div>
          <div class="section delivery-f2f">
            <span class="section-id">FC01</span>
            <span class="section-instructor">Elias Gonzalez</span>
            <span class="total-seats-count">20</span>
            <span class="open-seats-count">0</span>
            <span class="waitlist-count">0</span>
            <span class="holdfile-count">6</span>
            <div class="section-texts-container">
              <div class="section-text">Restricted to students in Freshmen Connection.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </body>
</html>
```

- [ ] **Step 2: Add a failing realistic-fixture test**

Append:

```ts
import { readFileSync } from "node:fs";

const cmsc131Fixture = readFileSync(
  new URL("./fixtures/cmsc131-202608.html", import.meta.url),
  "utf8",
);

it("parses the trimmed CMSC131 Testudo fixture", () => {
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
```

- [ ] **Step 3: Run the fixture test**

Run: `npm test -- src/testudo/parse-course-page.test.ts`

Expected: PASS. If it fails, fix the production selector or fixture only when comparison with the saved real markup proves which one is inaccurate.

- [ ] **Step 4: Add the opt-in live parser test**

Create `src/testudo/parse-course-page.integration.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { parseCoursePage } from "./parse-course-page.js";

const runLiveTests = process.env.RUN_LIVE_TESTS === "true";

describe.skipIf(!runLiveTests)("Testudo course parser integration", () => {
  it(
    "parses the live Fall 2026 CMSC131 detail page",
    async () => {
      const response = await fetch(
        "https://app.testudo.umd.edu/soc/202608/CMSC/CMSC131",
        {
          headers: {
            accept: "text/html,application/xhtml+xml",
            "user-agent": "umd-schedule-builder/0.1",
          },
        },
      );
      expect(response.ok).toBe(true);

      const result = parseCoursePage({
        html: await response.text(),
        semester: "202608",
        sourceUrl: response.url,
      });

      expect(result.course.id).toBe("CMSC131");
      expect(result.course.sections.length).toBeGreaterThan(0);
      expect(result.course.sections[0]?.id).toMatch(/^CMSC131-[A-Z0-9]{4}$/);
      expect(result.course.sections[0]?.meetings.length).toBeGreaterThan(0);
    },
    20_000,
  );
});
```

- [ ] **Step 5: Expand the live-test script and verify offline checks**

Change the script in `package.json` to:

```json
"test:live": "RUN_LIVE_TESTS=true vitest run src/testudo/*.integration.test.ts"
```

Run: `npm run check`

Expected: type checking and all offline tests PASS; neither integration test runs.

- [ ] **Step 6: Run both opt-in live tests**

Run: `npm run test:live`

Expected: the existing department-fetch integration and the new CMSC131 parser integration both PASS.

- [ ] **Step 7: Commit realistic and live coverage**

```bash
git add package.json package-lock.json src/testudo/fixtures/cmsc131-202608.html src/testudo/parse-course-page.test.ts src/testudo/parse-course-page.integration.test.ts
git commit -m "Verify parser against Testudo markup"
```

---

### Task 5: Final Acceptance Verification

**Files:**
- Modify only if verification exposes a parser defect covered by a new failing test.

**Interfaces:**
- Consumes: the full parser and project scripts from Tasks 1-4.
- Produces: current evidence that the parser meets every approved acceptance criterion.

- [ ] **Step 1: Run the complete offline suite**

Run: `npm run check`

Expected: strict TypeScript checking passes and every offline test passes with zero failures.

- [ ] **Step 2: Run both live integrations**

Run: `npm run test:live`

Expected: both live Testudo integration tests pass.

- [ ] **Step 3: Review the parser against the approved model**

Verify these concrete properties in the unit-test assertions and implementation:

```text
semester returned at result level
course and composed section IDs required
holdFile and waitlist nullable when absent
section notes preserved as strings
12-hour times normalized to minutes
malformed section skips only that section
malformed meeting skips only that meeting
errors and warnings never contain the full HTML input
```

- [ ] **Step 4: Check repository hygiene**

Run: `git status --short && git diff --check && git log --oneline --decorate -7`

Expected: no uncommitted parser changes, no whitespace errors, and four focused parser commits after the spec and plan commits. Leave the unrelated untracked `docs/superpowers/.DS_Store` untouched unless the user separately asks to remove or ignore it.
