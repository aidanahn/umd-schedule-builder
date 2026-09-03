import "dotenv/config";

import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { runAllDepartmentsWorker } from "../worker/all-departments-worker.js";
import { runIngestionWorker } from "../worker/ingestion-worker.js";
import { runAllDepartmentIngestion } from "./ingest-all.js";
import { runDatabaseIngestion } from "./ingest-db.js";
import { parseScrapeArgs } from "./scrape.js";

export type IngestionWorkerConfig =
  | {
      mode: "single";
      semester: string;
      department: string;
      intervalMs: number;
    }
  | {
      mode: "all";
      semester: "202608";
      intervalMs: number;
      departmentDelayMs: number;
    };

export type IngestionWorkerEnvironment = {
  [key: string]: string | undefined;
  INGEST_SEMESTER?: string;
  INGEST_DEPARTMENT?: string;
  INGEST_INTERVAL_SECONDS?: string;
  INGEST_ALL_DEPARTMENTS?: string;
  INGEST_DEPARTMENT_DELAY_SECONDS?: string;
};

type ShutdownSignal = "SIGINT" | "SIGTERM";

export type IngestionWorkerShutdownTarget = {
  once(signal: ShutdownSignal, listener: () => void): unknown;
  off(signal: ShutdownSignal, listener: () => void): unknown;
};

export type IngestionWorkerCliOptions = {
  env?: IngestionWorkerEnvironment;
  signal: AbortSignal;
  runDatabaseIngestion?: typeof runDatabaseIngestion;
  runAllDepartmentIngestion?: typeof runAllDepartmentIngestion;
  runWorker?: typeof runIngestionWorker;
  runAllWorker?: typeof runAllDepartmentsWorker;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
};

export function parseIngestionWorkerArgs(
  argv: string[],
  env: IngestionWorkerEnvironment = process.env,
): IngestionWorkerConfig {
  const { values } = parseArgs({
    args: argv,
    options: {
      semester: { type: "string" },
      department: { type: "string" },
      "interval-seconds": { type: "string" },
      "all-departments": { type: "boolean" },
      "department-delay-seconds": { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });

  const semester = values.semester ?? env.INGEST_SEMESTER;
  const department = values.department ?? env.INGEST_DEPARTMENT;
  const interval =
    values["interval-seconds"] ?? env.INGEST_INTERVAL_SECONDS ?? "300";
  const allValue =
    values["all-departments"] ??
    parseBoolean(env.INGEST_ALL_DEPARTMENTS);

  if (!semester) {
    throw new Error("--semester or INGEST_SEMESTER is required");
  }
  if (allValue && department) {
    throw new Error(
      "all-departments mode cannot be combined with a department",
    );
  }
  if (!allValue && !department) {
    throw new Error("--department or INGEST_DEPARTMENT is required");
  }
  if (!/^\d+$/.test(interval)) {
    throw new Error(
      "ingestion interval must be an integer of at least 60 seconds",
    );
  }

  const intervalSeconds = Number(interval);
  if (!Number.isSafeInteger(intervalSeconds) || intervalSeconds < 60) {
    throw new Error(
      "ingestion interval must be an integer of at least 60 seconds",
    );
  }

  if (allValue) {
    if (semester !== "202608") {
      throw new Error("all-departments mode only supports semester 202608");
    }
    const departmentDelay =
      values["department-delay-seconds"] ??
      env.INGEST_DEPARTMENT_DELAY_SECONDS ??
      "5";
    if (
      !/^\d+$/.test(departmentDelay) ||
      !Number.isSafeInteger(Number(departmentDelay))
    ) {
      throw new Error("department delay must be a nonnegative whole number");
    }
    return {
      mode: "all",
      semester: "202608",
      intervalMs: intervalSeconds * 1_000,
      departmentDelayMs: Number(departmentDelay) * 1_000,
    };
  }

  const input = parseScrapeArgs([
    "--semester",
    semester,
    "--department",
    department!,
  ]);

  return {
    mode: "single",
    ...input,
    intervalMs: intervalSeconds * 1_000,
  };
}

function parseBoolean(value: string | undefined): boolean {
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  throw new Error("INGEST_ALL_DEPARTMENTS must be true or false");
}

export function registerIngestionWorkerShutdown(
  target: IngestionWorkerShutdownTarget,
  controller: AbortController,
): () => void {
  const shutdown = () => controller.abort();
  target.once("SIGINT", shutdown);
  target.once("SIGTERM", shutdown);

  return () => {
    target.off("SIGINT", shutdown);
    target.off("SIGTERM", shutdown);
  };
}

export async function runIngestionWorkerCommand(
  argv: string[],
  options: IngestionWorkerCliOptions,
): Promise<number> {
  const stdout = options.stdout ?? console.log;
  const stderr = options.stderr ?? console.error;
  let config: IngestionWorkerConfig;

  try {
    config = parseIngestionWorkerArgs(argv, options.env);
  } catch (error) {
    stderr(error instanceof Error ? error.message : "Invalid arguments");
    return 2;
  }

  try {
    if (config.mode === "all") {
      const runCycle =
        options.runAllDepartmentIngestion ?? runAllDepartmentIngestion;
      await (options.runAllWorker ?? runAllDepartmentsWorker)(
        {
          semester: config.semester,
          intervalMs: config.intervalMs,
          departmentDelayMs: config.departmentDelayMs,
          signal: options.signal,
        },
        {
          runCycle: (input) =>
            runCycle(
              [
                "--semester",
                input.semester,
                "--department-delay-seconds",
                String(input.departmentDelayMs / 1_000),
              ],
              { signal: input.signal, stdout, stderr },
            ),
          stdout,
          stderr,
        },
      );
    } else {
      const runOnce = options.runDatabaseIngestion ?? runDatabaseIngestion;
      await (options.runWorker ?? runIngestionWorker)(
        {
          semester: config.semester,
          department: config.department,
          intervalMs: config.intervalMs,
          signal: options.signal,
        },
        {
          runIngestion: (input) =>
            runOnce(
              [
                "--semester",
                input.semester,
                "--department",
                input.department,
              ],
              { stdout, stderr },
            ),
          stdout,
          stderr,
        },
      );
    }
    return 0;
  } catch {
    stderr("Ingestion worker failed");
    return 1;
  }
}

async function main(): Promise<void> {
  const controller = new AbortController();
  const cleanup = registerIngestionWorkerShutdown(process, controller);

  try {
    process.exitCode = await runIngestionWorkerCommand(process.argv.slice(2), {
      signal: controller.signal,
    });
  } finally {
    cleanup();
  }
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  void main();
}
