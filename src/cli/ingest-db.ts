import "dotenv/config";

import { pathToFileURL } from "node:url";

import {
  createDatabaseConnection,
  DatabaseConfigurationError,
  type AppDatabase,
} from "../db/connection.js";
import {
  persistDepartmentSnapshot,
  type PersistDepartmentSnapshotResult,
} from "../db/persist-department-snapshot.js";
import { SnapshotPersistenceError } from "../db/snapshot-records.js";
import type { DepartmentSnapshot } from "../testudo/build-department-snapshot.js";
import { collectDepartmentSnapshot } from "../testudo/collect-department-snapshot.js";
import { parseScrapeArgs } from "./scrape.js";

type DatabaseIngestionConnection = {
  db: AppDatabase;
  close(): Promise<void>;
};

export type DatabaseIngestionCliOptions = {
  collect?: typeof collectDepartmentSnapshot;
  connect?: () => DatabaseIngestionConnection;
  persist?: typeof persistDepartmentSnapshot;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
};

function printSuccess(
  result: PersistDepartmentSnapshotResult,
  stdout: (message: string) => void,
): void {
  if (result.alreadyPersisted) {
    stdout(`Ingestion ${result.ingestionId} already persisted`);
    return;
  }

  stdout(
    `Persisted ingestion ${result.ingestionId} (${result.observationsInserted} observations, ${result.eventsInserted} events)`,
  );
}

function collectionErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Snapshot collection failed";
}

function connectionErrorMessage(error: unknown): string {
  return error instanceof DatabaseConfigurationError
    ? error.message
    : "Database connection failed";
}

function persistenceErrorMessage(error: unknown): string {
  return error instanceof SnapshotPersistenceError
    ? error.message
    : "Database ingestion failed";
}

export async function runDatabaseIngestion(
  argv: string[],
  options: DatabaseIngestionCliOptions = {},
): Promise<number> {
  const stdout = options.stdout ?? console.log;
  const stderr = options.stderr ?? console.error;
  let input: ReturnType<typeof parseScrapeArgs>;

  try {
    input = parseScrapeArgs(argv);
  } catch (error) {
    stderr(error instanceof Error ? error.message : "Invalid arguments");
    return 2;
  }

  let snapshot: DepartmentSnapshot;
  try {
    snapshot = await (options.collect ?? collectDepartmentSnapshot)(input);
  } catch (error) {
    stderr(collectionErrorMessage(error));
    return 1;
  }

  let connection: DatabaseIngestionConnection;
  try {
    connection = (options.connect ?? createDatabaseConnection)();
  } catch (error) {
    stderr(connectionErrorMessage(error));
    return 1;
  }

  let exitCode = 0;
  try {
    const result = await (options.persist ?? persistDepartmentSnapshot)(
      connection.db,
      snapshot,
    );
    printSuccess(result, stdout);
  } catch (error) {
    stderr(persistenceErrorMessage(error));
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
  process.exitCode = await runDatabaseIngestion(process.argv.slice(2));
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  void main();
}
