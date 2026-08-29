import {
  collectDepartmentSnapshot,
  type CollectDepartmentSnapshotOptions,
  type IngestDepartmentInput,
} from "./collect-department-snapshot.js";
import type { DepartmentSnapshot } from "./build-department-snapshot.js";
import {
  writeDepartmentSnapshot,
  type WriteDepartmentSnapshotOptions,
} from "./write-snapshot.js";

export type { IngestDepartmentInput } from "./collect-department-snapshot.js";

export type IngestDepartmentResult = {
  snapshot: DepartmentSnapshot;
  path: string;
};

export type IngestDepartmentOptions = CollectDepartmentSnapshotOptions & {
  writeSnapshot?: typeof writeDepartmentSnapshot;
  outputRoot?: string;
};

export async function ingestDepartment(
  input: IngestDepartmentInput,
  options: IngestDepartmentOptions = {},
): Promise<IngestDepartmentResult> {
  const { writeSnapshot, outputRoot, ...collectOptions } = options;
  const snapshot = await collectDepartmentSnapshot(input, collectOptions);
  const writeOptions: WriteDepartmentSnapshotOptions = outputRoot
    ? { outputRoot }
    : {};
  const path = await (writeSnapshot ?? writeDepartmentSnapshot)(
    snapshot,
    writeOptions,
  );

  return { snapshot, path };
}
