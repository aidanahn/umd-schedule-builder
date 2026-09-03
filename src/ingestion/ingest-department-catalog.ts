import type { AppDatabase } from "../db/connection.js";
import { SnapshotPersistenceError } from "../db/snapshot-records.js";
import {
  persistDepartmentSnapshot,
  type PersistDepartmentSnapshotResult,
} from "../db/persist-department-snapshot.js";
import {
  collectDepartmentSnapshot,
  type IngestDepartmentInput,
} from "../testudo/collect-department-snapshot.js";
import {
  DepartmentSnapshotError,
  type DepartmentSnapshot,
} from "../testudo/build-department-snapshot.js";
import type { TestudoDepartment } from "../testudo/discover-semester-departments.js";
import { TestudoFetchError } from "../testudo/fetch-department-page.js";

export interface IngestDepartmentCatalogOptions {
  semester: string;
  departments: readonly TestudoDepartment[];
  departmentDelayMs: number;
  signal: AbortSignal;
}

export interface DepartmentCatalogFailure {
  department: string;
  stage: "collection" | "persistence";
  code: string;
  message: string;
}

export interface DepartmentCatalogIngestionSummary {
  discovered: number;
  attempted: number;
  succeeded: number;
  failed: number;
  coursesParsed: number;
  sectionsParsed: number;
  observationsInserted: number;
  eventsInserted: number;
  failures: DepartmentCatalogFailure[];
  aborted: boolean;
}

type Collect = (input: IngestDepartmentInput) => Promise<DepartmentSnapshot>;
type Persist = (
  db: AppDatabase,
  snapshot: DepartmentSnapshot,
) => Promise<PersistDepartmentSnapshotResult>;

export interface IngestDepartmentCatalogDependencies {
  collect?: Collect;
  persist?: Persist;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
}

function defaultWait(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(done, delayMs);
    function done() {
      clearTimeout(timeout);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

function knownCollectionError(
  error: unknown,
): { code: string; message: string } | null {
  if (
    error instanceof TestudoFetchError ||
    error instanceof DepartmentSnapshotError
  ) {
    return { code: error.code, message: error.message };
  }
  return null;
}

function knownPersistenceError(
  error: unknown,
): { code: string; message: string } | null {
  return error instanceof SnapshotPersistenceError
    ? { code: error.code, message: error.message }
    : null;
}

export async function ingestDepartmentCatalog(
  db: AppDatabase,
  options: IngestDepartmentCatalogOptions,
  dependencies: IngestDepartmentCatalogDependencies = {},
): Promise<DepartmentCatalogIngestionSummary> {
  if (
    !Number.isSafeInteger(options.departmentDelayMs) ||
    options.departmentDelayMs < 0
  ) {
    throw new RangeError(
      "departmentDelayMs must be a nonnegative safe integer",
    );
  }

  const collect = dependencies.collect ?? collectDepartmentSnapshot;
  const persist = dependencies.persist ?? persistDepartmentSnapshot;
  const wait = dependencies.wait ?? defaultWait;
  const failures: DepartmentCatalogFailure[] = [];
  let attempted = 0;
  let succeeded = 0;
  let coursesParsed = 0;
  let sectionsParsed = 0;
  let observationsInserted = 0;
  let eventsInserted = 0;

  for (let index = 0; index < options.departments.length; index += 1) {
    if (options.signal.aborted) break;
    const department = options.departments[index]!;
    attempted += 1;
    let value: DepartmentSnapshot;

    try {
      value = await collect({
        semester: options.semester,
        department: department.code,
      });
    } catch (error) {
      const known = knownCollectionError(error);
      failures.push({
        department: department.code,
        stage: "collection",
        code: known?.code ?? "COLLECTION_FAILED",
        message: known?.message ?? "Department collection failed",
      });
      dependencies.stderr?.(`${department.code}: collection failed`);
      if (index < options.departments.length - 1 && !options.signal.aborted) {
        await wait(options.departmentDelayMs, options.signal);
      }
      continue;
    }

    try {
      const result = await persist(db, value);
      succeeded += 1;
      coursesParsed += value.summary.coursesParsed;
      sectionsParsed += value.summary.sectionsParsed;
      observationsInserted += result.observationsInserted;
      eventsInserted += result.eventsInserted;
      dependencies.stdout?.(`${department.code}: ingested`);
    } catch (error) {
      const known = knownPersistenceError(error);
      failures.push({
        department: department.code,
        stage: "persistence",
        code: known?.code ?? "PERSISTENCE_FAILED",
        message: known?.message ?? "Department persistence failed",
      });
      dependencies.stderr?.(`${department.code}: persistence failed`);
    }

    if (index < options.departments.length - 1 && !options.signal.aborted) {
      await wait(options.departmentDelayMs, options.signal);
    }
  }

  return {
    discovered: options.departments.length,
    attempted,
    succeeded,
    failed: failures.length,
    coursesParsed,
    sectionsParsed,
    observationsInserted,
    eventsInserted,
    failures,
    aborted: options.signal.aborted,
  };
}
