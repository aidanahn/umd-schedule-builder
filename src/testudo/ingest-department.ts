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
import {
  writeDepartmentSnapshot,
  type WriteDepartmentSnapshotOptions,
} from "./write-snapshot.js";

export type IngestDepartmentInput = {
  semester: string;
  department: string;
};

export type IngestDepartmentResult = {
  snapshot: DepartmentSnapshot;
  path: string;
};

export type IngestDepartmentOptions = {
  fetchPage?: typeof fetchDepartmentPage;
  fetchSections?: typeof fetchDepartmentSections;
  writeSnapshot?: typeof writeDepartmentSnapshot;
  now?: () => Date;
  outputRoot?: string;
};

export async function ingestDepartment(
  input: IngestDepartmentInput,
  options: IngestDepartmentOptions = {},
): Promise<IngestDepartmentResult> {
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
  const snapshot = buildDepartmentSnapshot({
    ...normalizedInput,
    html: fetched.html,
    sectionsHtml: sections.html,
    collectedAt: (options.now ?? (() => new Date()))().toISOString(),
    sourceUrl: fetched.finalUrl,
  });
  const writeOptions: WriteDepartmentSnapshotOptions = options.outputRoot
    ? { outputRoot: options.outputRoot }
    : {};
  const path = await (options.writeSnapshot ?? writeDepartmentSnapshot)(
    snapshot,
    writeOptions,
  );

  return { snapshot, path };
}
