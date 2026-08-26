import { load } from "cheerio";

import {
  parseCoursePage,
  TestudoParseError,
  type Course,
  type ParseWarning,
} from "./parse-course-page.js";

export type SnapshotWarning = ParseWarning & { courseId: string };
export type SnapshotFailure = {
  courseId: string | null;
  code: string;
  message: string;
};
export type DepartmentSnapshot = {
  schemaVersion: 1;
  semester: string;
  department: string;
  collectedAt: string;
  sourceUrl: string;
  status: "complete" | "partial";
  summary: {
    coursesFound: number;
    coursesParsed: number;
    coursesFailed: number;
    sectionsParsed: number;
  };
  courses: Course[];
  warnings: SnapshotWarning[];
  failures: SnapshotFailure[];
};
export type BuildDepartmentSnapshotInput = {
  html: string;
  semester: string;
  department: string;
  collectedAt: string;
  sourceUrl: string;
};
export type DepartmentSnapshotErrorCode =
  | "NO_COURSES_FOUND"
  | "NO_COURSES_PARSED";

export class DepartmentSnapshotError extends Error {
  constructor(
    public readonly code: DepartmentSnapshotErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DepartmentSnapshotError";
  }
}

function visibleCourseId(text: string): string | null {
  const id = text.replace(/\s+/g, "").toUpperCase();
  return /^[A-Z]{4}\d{3}[A-Z]?$/.test(id) ? id : null;
}

export function buildDepartmentSnapshot(
  input: BuildDepartmentSnapshotInput,
): DepartmentSnapshot {
  const $ = load(input.html);
  const courseNodes = $(".course")
    .filter((_index, element) => $(element).parents(".course").length === 0)
    .toArray();

  if (courseNodes.length === 0) {
    throw new DepartmentSnapshotError(
      "NO_COURSES_FOUND",
      "Testudo department page did not contain course containers",
    );
  }

  const courses: Course[] = [];
  const warnings: SnapshotWarning[] = [];
  const failures: SnapshotFailure[] = [];

  for (const element of courseNodes) {
    const container = $(element);
    const courseId = visibleCourseId(container.find(".course-id").first().text());

    try {
      const result = parseCoursePage({
        html: $.html(element),
        semester: input.semester,
        sourceUrl: input.sourceUrl,
      });
      courses.push(result.course);
      warnings.push(
        ...result.warnings.map((warning) => ({
          ...warning,
          courseId: result.course.id,
        })),
      );
    } catch (error) {
      failures.push(
        error instanceof TestudoParseError
          ? { courseId, code: error.code, message: error.message }
          : {
              courseId,
              code: "UNEXPECTED_PARSE_ERROR",
              message: "Course parser failed unexpectedly",
            },
      );
    }
  }

  if (courses.length === 0) {
    throw new DepartmentSnapshotError(
      "NO_COURSES_PARSED",
      "No Testudo courses could be parsed",
    );
  }

  return {
    schemaVersion: 1,
    semester: input.semester,
    department: input.department,
    collectedAt: input.collectedAt,
    sourceUrl: input.sourceUrl,
    status: failures.length === 0 ? "complete" : "partial",
    summary: {
      coursesFound: courseNodes.length,
      coursesParsed: courses.length,
      coursesFailed: failures.length,
      sectionsParsed: courses.reduce(
        (count, course) => count + course.sections.length,
        0,
      ),
    },
    courses,
    warnings,
    failures,
  };
}
