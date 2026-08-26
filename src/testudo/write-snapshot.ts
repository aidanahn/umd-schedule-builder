import { randomUUID } from "node:crypto";
import { link, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { DepartmentSnapshot } from "./build-department-snapshot.js";

export type SnapshotFileOperations = {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  writeFile(
    path: string,
    data: string,
    options: { encoding: "utf8"; flag: "wx" },
  ): Promise<void>;
  link(existingPath: string, newPath: string): Promise<void>;
  rm(path: string, options: { force: true }): Promise<void>;
};

export type WriteDepartmentSnapshotOptions = {
  outputRoot?: string;
  temporarySuffix?: string;
  fileOperations?: SnapshotFileOperations;
};

const defaultOperations: SnapshotFileOperations = {
  mkdir,
  writeFile,
  link,
  rm,
};

function timestampFilename(collectedAt: string): string {
  return `${collectedAt.replace(/[:.]/g, "-")}.json`;
}

export async function writeDepartmentSnapshot(
  snapshot: DepartmentSnapshot,
  options: WriteDepartmentSnapshotOptions = {},
): Promise<string> {
  const outputRoot = options.outputRoot ?? "data/snapshots";
  const temporarySuffix = options.temporarySuffix ?? randomUUID();
  const fileOperations = options.fileOperations ?? defaultOperations;
  const directory = join(outputRoot, snapshot.semester, snapshot.department);
  const finalPath = join(directory, timestampFilename(snapshot.collectedAt));
  const temporaryPath = `${finalPath}.${temporarySuffix}.tmp`;

  await fileOperations.mkdir(directory, { recursive: true });

  try {
    await fileOperations.writeFile(
      temporaryPath,
      `${JSON.stringify(snapshot, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    await fileOperations.link(temporaryPath, finalPath);
  } catch (error) {
    await fileOperations.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }

  await fileOperations.rm(temporaryPath, { force: true });
  return finalPath;
}
