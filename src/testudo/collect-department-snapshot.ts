import {
  buildDepartmentSnapshot,
  DepartmentSnapshotError,
  findDepartmentCourseIds,
  type DepartmentSnapshot,
} from "./build-department-snapshot.js";
import {
  fetchDepartmentPage,
  fetchDepartmentSections,
} from "./fetch-department-page.js";

export type IngestDepartmentInput = {
  semester: string;
  department: string;
};

export type CollectDepartmentSnapshotOptions = {
  fetchPage?: typeof fetchDepartmentPage;
  fetchSections?: typeof fetchDepartmentSections;
  now?: () => Date;
};

export async function collectDepartmentSnapshot(
  input: IngestDepartmentInput,
  options: CollectDepartmentSnapshotOptions = {},
): Promise<DepartmentSnapshot> {
  const normalizedInput = {
    semester: input.semester,
    department: input.department.toUpperCase(),
  };
  const fetched = await (options.fetchPage ?? fetchDepartmentPage)(
    normalizedInput,
  );
  const courseIds = findDepartmentCourseIds(fetched.html);

  if (courseIds.length === 0) {
    throw new DepartmentSnapshotError(
      "NO_COURSES_FOUND",
      "Testudo department page did not contain course containers",
    );
  }

  const sections = await (
    options.fetchSections ?? fetchDepartmentSections
  )({
    semester: normalizedInput.semester,
    courseIds,
  });

  return buildDepartmentSnapshot({
    ...normalizedInput,
    html: fetched.html,
    sectionsHtml: sections.html,
    collectedAt: (options.now ?? (() => new Date()))().toISOString(),
    sourceUrl: fetched.finalUrl,
  });
}
