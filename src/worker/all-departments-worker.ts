export interface AllDepartmentsWorkerOptions {
  semester: "202608";
  departmentDelayMs: number;
  intervalMs: number;
  signal: AbortSignal;
}

export interface AllDepartmentsWorkerDependencies {
  runCycle(input: {
    semester: string;
    departmentDelayMs: number;
    signal: AbortSignal;
  }): Promise<number>;
  wait?: (intervalMs: number, signal: AbortSignal) => Promise<void>;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
}

function waitForDelay(intervalMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
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

export async function runAllDepartmentsWorker(
  options: AllDepartmentsWorkerOptions,
  dependencies: AllDepartmentsWorkerDependencies,
): Promise<void> {
  const wait = dependencies.wait ?? waitForDelay;
  const stdout = dependencies.stdout ?? console.log;
  const stderr = dependencies.stderr ?? console.error;
  const intervalSeconds = options.intervalMs / 1_000;
  stdout(
    `All-departments worker started for ${options.semester} (${intervalSeconds}-second interval)`,
  );

  while (!options.signal.aborted) {
    let exitCode = 1;
    let unexpected = false;
    try {
      exitCode = await dependencies.runCycle({
        semester: options.semester,
        departmentDelayMs: options.departmentDelayMs,
        signal: options.signal,
      });
    } catch {
      unexpected = true;
      stderr(
        `Catalog ingestion cycle failed unexpectedly; retrying in ${intervalSeconds} seconds`,
      );
    }

    if (options.signal.aborted) break;
    if (exitCode !== 0 && !unexpected) {
      stderr(
        `Catalog ingestion cycle failed; retrying in ${intervalSeconds} seconds`,
      );
    }
    await wait(options.intervalMs, options.signal);
  }

  stdout("All-departments worker stopped");
}
