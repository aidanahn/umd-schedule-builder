import type { IngestDepartmentInput } from "../testudo/collect-department-snapshot.js";

export type IngestionWorkerOptions = IngestDepartmentInput & {
  intervalMs: number;
  signal: AbortSignal;
};

export type IngestionWorkerDependencies = {
  runIngestion(input: IngestDepartmentInput): Promise<number>;
  wait?(intervalMs: number, signal: AbortSignal): Promise<void>;
  stdout?(message: string): void;
  stderr?(message: string): void;
};

function waitForDelay(intervalMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, intervalMs);
    signal.addEventListener("abort", finish, { once: true });
  });
}

export async function runIngestionWorker(
  options: IngestionWorkerOptions,
  dependencies: IngestionWorkerDependencies,
): Promise<void> {
  const input = {
    semester: options.semester,
    department: options.department,
  };
  const wait = dependencies.wait ?? waitForDelay;
  const stdout = dependencies.stdout ?? console.log;
  const stderr = dependencies.stderr ?? console.error;
  const intervalSeconds = options.intervalMs / 1_000;

  stdout(
    `Ingestion worker started for ${input.semester} ${input.department} (${intervalSeconds}-second interval)`,
  );

  while (!options.signal.aborted) {
    let exitCode: number;
    let failureReported = false;
    try {
      exitCode = await dependencies.runIngestion(input);
    } catch {
      exitCode = 1;
      failureReported = true;
      stderr(
        `Ingestion attempt failed unexpectedly; retrying in ${intervalSeconds} seconds`,
      );
    }

    if (options.signal.aborted) {
      break;
    }
    if (exitCode !== 0 && !failureReported) {
      stderr(`Ingestion attempt failed; retrying in ${intervalSeconds} seconds`);
    }

    await wait(options.intervalMs, options.signal);
  }

  stdout("Ingestion worker stopped");
}
