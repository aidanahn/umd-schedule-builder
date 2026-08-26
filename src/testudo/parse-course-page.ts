import { load, type CheerioAPI } from "cheerio";

type Selection = ReturnType<CheerioAPI>;

export type CreditRange = {
  min: number;
  max: number;
};

export type LabeledText = {
  label: string;
  text: string;
};

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

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function parseCredit(value: string): number | undefined {
  const normalized = cleanText(value);
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    return undefined;
  }

  return Number(normalized);
}

function errorMetadata(input: ParseCoursePageInput, field: string) {
  return input.sourceUrl
    ? { field, sourceUrl: input.sourceUrl }
    : { field };
}

type CourseMetadata = {
  description: string | null;
  requirements: LabeledText[];
};

type CourseMetadataAccumulator = {
  descriptionParts: string[];
  descriptionKeys: Set<string>;
  requirements: LabeledText[];
  requirementKeys: Set<string>;
};

function addCourseText(
  metadata: CourseMetadataAccumulator,
  displayedLabel: string | null,
  displayedText: string,
): void {
  const label = normalizeMetadataLabel(displayedLabel ?? "");
  const text = cleanText(displayedText);

  if (!text) {
    return;
  }

  if (label) {
    const key = `${label.toLowerCase()}\u0000${text.toLowerCase()}`;
    if (!metadata.requirementKeys.has(key)) {
      metadata.requirementKeys.add(key);
      metadata.requirements.push({ label, text });
    }
    return;
  }

  const key = text.toLowerCase();
  if (!metadata.descriptionKeys.has(key)) {
    metadata.descriptionKeys.add(key);
    metadata.descriptionParts.push(text);
  }
}

const UNLABELED_REQUIREMENT_PATTERNS: ReadonlyArray<{
  label: string;
  pattern: RegExp;
}> = [
  { label: "Restriction", pattern: /^Must be\b/i },
  { label: "Prerequisite", pattern: /^Minimum grade of\b/i },
  { label: "Restriction", pattern: /^Permission of\b/i },
];

const NORMALIZED_METADATA_LABELS = new Map<string, string>([
  ["additional information", "Additional information"],
  ["corequisite", "Corequisite"],
  ["corequisites", "Corequisite"],
  ["credit only granted for", "Credit only granted for"],
  ["cross-listed with", "Cross-listed with"],
  ["formerly", "Formerly"],
  ["jointly offered with", "Jointly offered with"],
  ["prerequisite", "Prerequisite"],
  ["prerequisites", "Prerequisite"],
  ["recommended", "Recommended"],
  ["restriction", "Restriction"],
  ["restrictions", "Restriction"],
]);

const metadataLabelPattern = [...NORMALIZED_METADATA_LABELS.keys()].join("|");
const labelWithoutColonPattern = [
  "cross-listed with",
  "jointly offered with",
  "credit only granted for",
].join("|");
const INLINE_METADATA_MARKER = new RegExp(
  `(?:^|(?<=[.!?])\\s+)(?:(${metadataLabelPattern}):\\s*|(${labelWithoutColonPattern})\\s+)`,
  "gi",
);

function normalizeMetadataLabel(value: string): string {
  const label = cleanText(value).replace(/:$/, "");
  return NORMALIZED_METADATA_LABELS.get(label.toLowerCase()) ?? label;
}

function classifyUnlabeledCourseText(
  metadata: CourseMetadataAccumulator,
  displayedText: string,
): void {
  const text = cleanText(displayedText);
  if (!text) {
    return;
  }

  const markers = [...text.matchAll(INLINE_METADATA_MARKER)];
  if (markers.length > 0) {
    const firstMarkerIndex = markers[0]?.index ?? 0;
    addCourseText(metadata, null, text.slice(0, firstMarkerIndex));

    markers.forEach((marker, index) => {
      const label = marker[1]
        ? normalizeMetadataLabel(marker[1])
        : normalizeMetadataLabel(marker[2] ?? "");
      const textStart = (marker.index ?? 0) + marker[0].length;
      const textEnd = markers[index + 1]?.index ?? text.length;
      addCourseText(metadata, label, text.slice(textStart, textEnd));
    });
    return;
  }

  const inferredRequirement = UNLABELED_REQUIREMENT_PATTERNS.find(({ pattern }) =>
    pattern.test(text),
  );
  addCourseText(metadata, inferredRequirement?.label ?? null, text);
}

function splitCourseTextParagraphs(block: Selection): string[] {
  const html = block.html() ?? "";
  const withLineBreaks = html.replace(/<br\s*\/?\s*>/gi, "\n");
  const $fragment = load(`<div>${withLineBreaks}</div>`);

  return $fragment("div")
    .first()
    .text()
    .split(/\n\s*\n+/)
    .map(cleanText)
    .filter(Boolean);
}

function parseCourseMetadata($: CheerioAPI, course: Selection): CourseMetadata {
  const descriptionParts: string[] = [];
  const requirements: LabeledText[] = [];
  const metadata: CourseMetadataAccumulator = {
    descriptionParts,
    descriptionKeys: new Set(),
    requirements,
    requirementKeys: new Set(),
  };

  course
    .find(".approved-course-text, .course-text")
    .each((_index, element) => {
      const block = $(element);
      if (block.hasClass("course-text")) {
        splitCourseTextParagraphs(block).forEach((paragraph) =>
          classifyUnlabeledCourseText(metadata, paragraph),
        );
        return;
      }

      const labels = block.find("strong");

      if (labels.length === 0) {
        classifyUnlabeledCourseText(metadata, block.text());
        return;
      }

      labels.each((_labelIndex, labelElement) => {
        const labelNode = $(labelElement);
        const displayedLabel = cleanText(labelNode.text());
        const parentText = cleanText(labelNode.parent().text());
        const text = cleanText(parentText.slice(displayedLabel.length));

        addCourseText(metadata, displayedLabel, text);
      });
    });

  return {
    description:
      descriptionParts.length > 0 ? descriptionParts.join("\n\n") : null,
    requirements,
  };
}

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

function parseDeliveryMode(
  classNames: string | undefined,
): Section["deliveryMode"] {
  const classes = new Set((classNames ?? "").split(/\s+/));

  if (classes.has("delivery-f2f")) return "face-to-face";
  if (classes.has("delivery-blended")) return "blended";
  if (classes.has("delivery-online")) return "online";
  return "unknown";
}

const DAY_CODES: DayCode[] = ["Tu", "Th", "Sa", "Su", "M", "W", "F"];

function parseDays(value: string): DayCode[] {
  const normalized = cleanText(value);
  if (!normalized || /^(?:TBA|ARR)$/i.test(normalized)) {
    return [];
  }

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

  const isPm = match[3]?.toLowerCase() === "pm";
  return (hour % 12) * 60 + minute + (isPm ? 720 : 0);
}

function nullableText(value: string): string | null {
  const normalized = cleanText(value);
  return normalized || null;
}

function parseMeeting(meeting: Selection): Meeting {
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

function parseSection(
  $: CheerioAPI,
  section: Selection,
  courseId: string,
  warnings: ParseWarning[],
  sectionIndex: number,
): Section {
  const number = cleanText(
    section.find(".section-id").first().text(),
  ).toUpperCase();

  if (!/^[A-Z0-9]{4}$/.test(number)) {
    throw new RecordParseError(
      "section.number",
      "section number is missing or invalid",
    );
  }

  const waitlistNode = section.find(".waitlist-count").first();
  const holdFileNode = section.find(".holdfile-count").first();
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
    if (row.find(meetingSelector).length === 0) {
      return;
    }

    try {
      meetings.push(parseMeeting(row));
    } catch (error) {
      if (!(error instanceof RecordParseError)) {
        throw error;
      }

      warnings.push({
        code: "MEETING_SKIPPED",
        message: error.message,
        field: error.field,
        sectionNumber: number,
        sectionIndex,
      });
    }
  });

  return {
    id: `${courseId}-${number}`,
    number,
    instructors: unique(
      section
        .find(".section-instructor")
        .map((_index, node) => cleanText($(node).text()))
        .get(),
    ),
    deliveryMode: parseDeliveryMode(section.attr("class")),
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
    meetings,
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
  const courseMetadata = parseCourseMetadata($, course);
  const warnings: ParseWarning[] = [];
  const sections: Section[] = [];

  course.find(".sections-container .section").each((sectionIndex, element) => {
    const sectionNumber =
      cleanText(
        $(element).find(".section-id").first().text(),
      ).toUpperCase() || null;

    try {
      sections.push(
        parseSection($, $(element), id, warnings, sectionIndex),
      );
    } catch (error) {
      if (!(error instanceof RecordParseError)) {
        throw error;
      }

      warnings.push({
        code: "SECTION_SKIPPED",
        message: error.message,
        field: error.field,
        sectionNumber,
        sectionIndex,
      });
    }
  });

  return {
    semester: input.semester,
    course: {
      id,
      department: id.slice(0, 4),
      title,
      credits: { min, max },
      gradingMethods,
      genEdCodes,
      description: courseMetadata.description,
      requirements: courseMetadata.requirements,
      sections,
    },
    warnings,
  };
}
