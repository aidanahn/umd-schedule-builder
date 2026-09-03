import { load } from "cheerio";

import {
  fetchTestudoPage,
  TestudoFetchError,
  type FetchDepartmentPageOptions,
} from "./fetch-department-page.js";

const TESTUDO_ORIGIN = "https://app.testudo.umd.edu";

export interface TestudoDepartment {
  code: string;
  name: string;
  url: string;
}

export interface ParseSemesterDepartmentsInput {
  semester: string;
  html: string;
  sourceUrl: string;
}

export type SemesterDiscoveryErrorCode =
  | "INVALID_INPUT"
  | "NO_DEPARTMENTS_FOUND";

export class SemesterDiscoveryError extends Error {
  constructor(
    public readonly code: SemesterDiscoveryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SemesterDiscoveryError";
  }
}

function validateSemester(semester: string): void {
  if (!/^\d{6}$/.test(semester)) {
    throw new SemesterDiscoveryError(
      "INVALID_INPUT",
      "semester must contain exactly six digits in YYYYMM format",
    );
  }
}

export function buildSemesterUrl(semester: string): string {
  validateSemester(semester);
  return new URL(`/soc/${semester}`, TESTUDO_ORIGIN).toString();
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function parseSemesterDepartments(
  input: ParseSemesterDepartmentsInput,
): TestudoDepartment[] {
  validateSemester(input.semester);

  let sourceUrl: URL;
  try {
    sourceUrl = new URL(input.sourceUrl);
  } catch {
    throw new SemesterDiscoveryError("INVALID_INPUT", "sourceUrl is invalid");
  }

  const departmentPath = new RegExp(`^/soc/${input.semester}/([A-Z]{4})/?$`);
  const departments: TestudoDepartment[] = [];
  const seen = new Set<string>();
  const $ = load(input.html);

  $("a[href]").each((_index, element) => {
    let candidate: URL;
    try {
      candidate = new URL($(element).attr("href")!, sourceUrl);
    } catch {
      return;
    }

    if (candidate.origin !== TESTUDO_ORIGIN) {
      return;
    }

    const match = departmentPath.exec(candidate.pathname);
    const code = match?.[1];
    if (!code || seen.has(code)) {
      return;
    }

    const text = normalizeText($(element).text());
    const name = normalizeText(text.replace(new RegExp(`^${code}\\b`), ""));
    seen.add(code);
    departments.push({
      code,
      name,
      url: new URL(`/soc/${input.semester}/${code}`, TESTUDO_ORIGIN).toString(),
    });
  });

  if (departments.length === 0) {
    throw new SemesterDiscoveryError(
      "NO_DEPARTMENTS_FOUND",
      "Testudo semester index did not contain department links",
    );
  }

  return departments;
}

export async function discoverSemesterDepartments(
  input: { semester: string },
  options: FetchDepartmentPageOptions = {},
): Promise<TestudoDepartment[]> {
  const url = buildSemesterUrl(input.semester);
  const fetched = await fetchTestudoPage(url, options);
  return parseSemesterDepartments({
    semester: input.semester,
    html: fetched.html,
    sourceUrl: fetched.finalUrl,
  });
}

export { TestudoFetchError };
