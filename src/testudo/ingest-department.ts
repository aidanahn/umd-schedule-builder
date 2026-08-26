import {
  buildDepartmentSnapshot,
  type DepartmentSnapshot,
} from "./build-department-snapshot.js";
import { fetchDepartmentPage } from "./fetch-department-page.js";
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
  const snapshot = buildDepartmentSnapshot({
    ...normalizedInput,
    html: fetched.html,
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
