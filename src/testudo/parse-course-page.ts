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

function parseApprovedText($: CheerioAPI, course: Selection) {
  const descriptionParts: string[] = [];
  const requirements: LabeledText[] = [];

  course.find(".approved-course-text").each((_index, element) => {
    const block = $(element);
    const labels = block.find("strong");

    if (labels.length === 0) {
      const text = cleanText(block.text());
      if (text) {
        descriptionParts.push(text);
      }
      return;
    }

    labels.each((_labelIndex, labelElement) => {
      const labelNode = $(labelElement);
      const displayedLabel = cleanText(labelNode.text());
      const label = displayedLabel.replace(/:$/, "");
      const parentText = cleanText(labelNode.parent().text());
      const text = cleanText(parentText.slice(displayedLabel.length));

      if (label && text) {
        requirements.push({ label, text });
      }
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
