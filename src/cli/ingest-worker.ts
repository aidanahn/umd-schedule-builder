import "dotenv/config";

import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { runIngestionWorker } from "../worker/ingestion-worker.js";
import { runDatabaseIngestion } from "./ingest-db.js";
import { parseScrapeArgs } from "./scrape.js";

export type IngestionWorkerConfig = {
  semester: string;
  department: string;
  intervalMs: number;
};

export type IngestionWorkerEnvironment = {
  [key: string]: string | undefined;
  INGEST_SEMESTER?: string;
  INGEST_DEPARTMENT?: string;
  INGEST_INTERVAL_SECONDS?: string;
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
  runWorker?: typeof runIngestionWorker;
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
    },
    strict: true,
    allowPositionals: false,
  });

  const semester = values.semester ?? env.INGEST_SEMESTER;
  const department = values.department ?? env.INGEST_DEPARTMENT;
  const interval =
    values["interval-seconds"] ?? env.INGEST_INTERVAL_SECONDS ?? "300";

  if (!semester) {
    throw new Error("--semester or INGEST_SEMESTER is required");
  }
  if (!department) {
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

  const input = parseScrapeArgs([
    "--semester",
    semester,
    "--department",
    department,
  ]);

  return {
    ...input,
    intervalMs: intervalSeconds * 1_000,
  };
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

  const runOnce = options.runDatabaseIngestion ?? runDatabaseIngestion;

  try {
    await (options.runWorker ?? runIngestionWorker)(
      { ...config, signal: options.signal },
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
