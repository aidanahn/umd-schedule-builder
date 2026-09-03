import "dotenv/config";

import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import {
  createDatabaseConnection,
  DatabaseConfigurationError,
  type AppDatabase,
} from "../db/connection.js";
import {
  ingestDepartmentCatalog,
  type DepartmentCatalogIngestionSummary,
} from "../ingestion/ingest-department-catalog.js";
import {
  discoverSemesterDepartments,
  SemesterDiscoveryError,
} from "../testudo/discover-semester-departments.js";
import { TestudoFetchError } from "../testudo/fetch-department-page.js";

export interface IngestAllArgs {
  semester: "202608";
  departmentDelayMs: number;
}

export function parseIngestAllArgs(argv: string[]): IngestAllArgs {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: {
      semester: { type: "string" },
      "department-delay-seconds": { type: "string" },
    },
  });
  if (!values.semester) throw new Error("--semester is required");
  if (values.semester !== "202608") {
    throw new Error("only semester 202608 is supported");
  }
  const delay = values["department-delay-seconds"] ?? "5";
  if (!/^\d+$/.test(delay) || !Number.isSafeInteger(Number(delay))) {
    throw new Error("department delay must be a nonnegative whole number");
  }
  return { semester: "202608", departmentDelayMs: Number(delay) * 1_000 };
}

type CatalogConnection = { db: AppDatabase; close(): Promise<void> };

export interface AllDepartmentIngestionCliOptions {
  signal: AbortSignal;
  discover?: typeof discoverSemesterDepartments;
  connect?: () => CatalogConnection;
  ingest?: typeof ingestDepartmentCatalog;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
}

function printSummary(
  summary: DepartmentCatalogIngestionSummary,
  stdout: (message: string) => void,
  stderr: (message: string) => void,
): void {
  stdout(
    `Catalog ingestion: ${summary.succeeded}/${summary.attempted} departments, ${summary.coursesParsed} courses, ${summary.sectionsParsed} sections, ${summary.observationsInserted} observations, ${summary.eventsInserted} events`,
  );
  for (const failure of summary.failures) {
    stderr(
      `${failure.department} [${failure.stage}/${failure.code}]: ${failure.message}`,
    );
  }
}

export async function runAllDepartmentIngestion(
  argv: string[],
  options: AllDepartmentIngestionCliOptions,
): Promise<number> {
  const stdout = options.stdout ?? console.log;
  const stderr = options.stderr ?? console.error;
  let input: IngestAllArgs;
  try {
    input = parseIngestAllArgs(argv);
  } catch (error) {
    stderr(error instanceof Error ? error.message : "Invalid arguments");
    return 2;
  }

  let departments;
  try {
    departments = await (options.discover ?? discoverSemesterDepartments)({
      semester: input.semester,
    });
  } catch (error) {
    stderr(
      error instanceof SemesterDiscoveryError || error instanceof TestudoFetchError
        ? error.message
        : "Department discovery failed",
    );
    return 1;
  }

  let connection: CatalogConnection;
  try {
    connection = (options.connect ?? createDatabaseConnection)();
  } catch (error) {
    stderr(
      error instanceof DatabaseConfigurationError
        ? error.message
        : "Database connection failed",
    );
    return 1;
  }

  let exitCode = 0;
  try {
    const summary = await (options.ingest ?? ingestDepartmentCatalog)(
      connection.db,
      {
        semester: input.semester,
        departments,
        departmentDelayMs: input.departmentDelayMs,
        signal: options.signal,
      },
      { stdout, stderr },
    );
    printSummary(summary, stdout, stderr);
    if (summary.failed > 0 || summary.aborted) exitCode = 1;
  } catch {
    stderr("Catalog ingestion failed");
    exitCode = 1;
  }

  try {
    await connection.close();
  } catch {
    stderr("Database connection cleanup failed");
    exitCode = 1;
  }
  return exitCode;
}

async function main(): Promise<void> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    process.exitCode = await runAllDepartmentIngestion(process.argv.slice(2), {
      signal: controller.signal,
    });
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  void main();
}
