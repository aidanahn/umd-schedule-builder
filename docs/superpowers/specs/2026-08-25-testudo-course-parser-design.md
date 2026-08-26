# Testudo Course Parser Design

## Goal

Parse one Testudo course-detail HTML page into typed, schedule-ready course and section data. The parser will support the first ingestion target, Fall 2026 CMSC, without coupling parsing to HTTP requests or persistence.

## Scope

This milestone parses a fetched course-detail page such as `/soc/202608/CMSC/CMSC131`. It does not discover course URLs from a department page, fetch multiple courses, write snapshots, compare seat history, or send notifications.

## Interface

```ts
type ParseCoursePageInput = {
  html: string;
  semester: string;
  sourceUrl?: string;
};

type ParseCoursePageResult = {
  semester: string;
  course: Course;
  warnings: ParseWarning[];
};

function parseCoursePage(input: ParseCoursePageInput): ParseCoursePageResult;
```

The parser is synchronous and pure. It does not fetch, write files, log, or retain global state.

`semester` must contain exactly six decimal digits in UMD's `YYYYMM` format. It comes from the ingestion context rather than being inferred from incidental page content.

## Data Model

```ts
type CreditRange = {
  min: number;
  max: number;
};

type LabeledText = {
  label: string;
  text: string;
};

type DayCode = "M" | "Tu" | "W" | "Th" | "F" | "Sa" | "Su";

type Meeting = {
  days: DayCode[];
  startMinutes: number | null;
  endMinutes: number | null;
  displayTime: string | null;
  building: string | null;
  room: string | null;
  type: string | null;
};

type Section = {
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

type Course = {
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

type ParseWarning = {
  code: "SECTION_SKIPPED" | "MEETING_SKIPPED" | "OPTIONAL_FIELD_INVALID";
  message: string;
  field: string;
  sectionNumber: string | null;
  sectionIndex: number | null;
};
```

Full section IDs use `<course-id>-<section-number>`, for example `CMSC131-0101`. The section number is also retained because Testudo displays and accepts it separately.

`requirements` preserves labeled academic text such as prerequisites, corequisites, restrictions, cross-listing, and credit exclusions. Unlabeled approved-course text is joined in display order as the description. This milestone does not interpret academic rules into prerequisite logic.

`notes` preserves section-specific restriction and informational text in display order. For example, a section may contain `"Restricted to students in Freshmen Connection."`. Notes remain opaque strings in this milestone; the parser does not decide whether a student satisfies them.

## Meeting Normalization

Testudo day strings are converted to ordered day codes. For example, `MWF` becomes `["M", "W", "F"]` and `TuTh` becomes `["Tu", "Th"]`.

Twelve-hour times are converted to minutes after midnight. For example, `10:00am` becomes `600`, `12:00am` becomes `0`, and `12:00pm` becomes `720`. The original time range is retained as `displayTime` for user-facing display.

When Testudo displays a meeting without a scheduled time, both minute fields and `displayTime` are `null`. Building, room, and meeting type are independently nullable.

An invalid day or time value rejects that meeting and records a warning. Other valid meetings in the section remain available.

## Parsing Strategy

Use Cheerio for DOM traversal. All selectors are scoped to their parent course, section, or meeting element so repeated class names cannot leak data between records.

Parsing proceeds in three layers:

1. Validate the input and required course identity.
2. Parse course metadata and labeled text.
3. Parse each section independently, then parse its meeting rows independently.

Whitespace is collapsed and HTML entities are decoded before values enter the model. Arrays preserve Testudo display order while removing empty values and exact duplicates.

Delivery mode is derived from Testudo's section classes: `delivery-f2f`, `delivery-blended`, or `delivery-online`. An unrecognized or missing delivery class produces `unknown` without rejecting the section.

## Required and Optional Data

The following fields are required at the course level:

- course ID;
- course title;
- minimum credit value.

A missing or invalid required course field rejects the full page with a typed parse error.

The following fields are required for each section:

- section number;
- total seat count;
- open seat count.

A malformed section is omitted while other sections continue parsing. Its warning includes the section number when available and its zero-based position among section elements.

Waitlist and hold-file counts are independently optional. If their markup is absent, their values are `null` without a warning. If Testudo displays either count but the value is malformed, that section is rejected because incorrect availability data could lead to bad notifications.

Instructor, building, room, meeting type, section notes, description, grading methods, GenEd codes, and requirements are optional. Missing optional markup is represented by `null` or an empty array and does not produce noise. A warning is reserved for markup that is present but invalid.

Only note text scoped to an individual section is added to that section. A page-level banner that applies to multiple sections is not duplicated onto every section unless Testudo renders the text inside each affected section.

The parser does not impose business rules such as `open <= total`. Testudo may represent seat management states that do not follow assumptions made by a generic enrollment system; the parser's job is to faithfully capture valid numeric values.

## Errors and Warnings

Fatal failures throw `TestudoParseError` with a stable code:

- `INVALID_INPUT` for an invalid semester or blank HTML;
- `COURSE_ID_MISSING` for a missing or invalid course ID;
- `COURSE_TITLE_MISSING` for a missing title;
- `CREDITS_INVALID` for a missing or malformed credit range;
- `PAGE_NOT_RECOGNIZED` when the HTML does not contain a Testudo course container.

Error metadata may include `sourceUrl` and field names, but it never contains the full HTML document.

Warnings are returned with valid data. They are machine-readable enough for future ingestion logs and concise enough to show during debugging. A skipped section or meeting produces one summary warning rather than one warning per missing descendant field.

## Tests and Fixtures

Unit tests use small HTML fixtures that exercise one behavior at a time:

- a normal course with multiple sections and lecture/discussion meetings;
- variable credits;
- multiple instructors;
- section-specific restrictions and informational notes;
- face-to-face, blended, online, and unknown delivery modes;
- GenEd codes and labeled requirements;
- HTML entities, duplicate values, and inconsistent whitespace;
- online or TBA meetings with no time or room;
- waitlist and hold-file counts present, absent, and malformed;
- one valid section beside a malformed section;
- one valid meeting beside a malformed meeting;
- required course-field failures;
- `12:00am`, `12:00pm`, and compound day-code normalization.

A trimmed, checked-in CMSC131 Testudo fixture protects the selectors against realistic nesting without making a network request. The fixture contains only enough source HTML to cover the course, section, seat, and meeting structures needed by the parser.

An opt-in live integration test will make one direct request to `202608/CMSC/CMSC131`, parse the result, and verify course identity and the presence of section data. Default tests remain offline. Course-detail fetch orchestration is intentionally deferred to the ingestion-coordinator milestone.

## File Structure

```text
src/testudo/
  parse-course-page.ts
  parse-course-page.test.ts
  parse-course-page.integration.test.ts
  fixtures/
    cmsc131-202608.html
```

Cheerio is the only new runtime dependency. The existing fetch module remains unchanged unless the live test reveals a real interface mismatch.

## Acceptance Criteria

- A representative CMSC131 page produces the approved course, section, seat, hold-file, and normalized meeting model.
- One malformed section does not prevent valid sibling sections from being returned.
- One malformed meeting does not prevent its section or valid sibling meetings from being returned.
- Course IDs and section IDs remain required.
- Missing waitlist or hold-file markup produces `null`, not zero.
- Section-specific restriction and note text is preserved without interpretation.
- Default tests and type checking pass without external requests.
- The opt-in live CMSC131 test passes against Testudo.
