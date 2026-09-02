import { describe, expect, test, vi } from "vitest";

import { runIngestionWorker } from "./ingestion-worker.js";

describe("runIngestionWorker", () => {
  test("runs immediately and waits after each completed ingestion", async () => {
    const controller = new AbortController();
    const sequence: string[] = [];
    let activeRuns = 0;
    let maxActiveRuns = 0;
    let waits = 0;

    const runIngestion = vi.fn(async () => {
      sequence.push("run");
      activeRuns += 1;
      maxActiveRuns = Math.max(maxActiveRuns, activeRuns);
      await Promise.resolve();
      activeRuns -= 1;
      return 0;
    });
    const wait = vi.fn(async (intervalMs: number) => {
      sequence.push(`wait:${intervalMs}`);
      waits += 1;
      if (waits === 2) {
        controller.abort();
      }
    });

    await runIngestionWorker(
      {
        semester: "202608",
        department: "CMSC",
        intervalMs: 300_000,
        signal: controller.signal,
      },
      { runIngestion, wait, stdout: vi.fn() },
    );

    expect(sequence).toEqual([
      "run",
      "wait:300000",
      "run",
      "wait:300000",
    ]);
    expect(runIngestion).toHaveBeenCalledWith({
      semester: "202608",
      department: "CMSC",
    });
    expect(maxActiveRuns).toBe(1);
  });

  test("continues after a failed ingestion attempt", async () => {
    const controller = new AbortController();
    const stderr = vi.fn();
    let attempts = 0;

    await runIngestionWorker(
      {
        semester: "202608",
        department: "CMSC",
        intervalMs: 60_000,
        signal: controller.signal,
      },
      {
        runIngestion: async () => {
          attempts += 1;
          return attempts === 1 ? 1 : 0;
        },
        wait: async () => {
          if (attempts === 2) {
            controller.abort();
          }
        },
        stdout: vi.fn(),
        stderr,
      },
    );

    expect(attempts).toBe(2);
    expect(stderr).toHaveBeenCalledWith(
      "Ingestion attempt failed; retrying in 60 seconds",
    );
  });

  test("sanitizes an unexpected attempt error and keeps running", async () => {
    const controller = new AbortController();
    const stderr = vi.fn();
    let attempts = 0;

    await runIngestionWorker(
      {
        semester: "202608",
        department: "CMSC",
        intervalMs: 60_000,
        signal: controller.signal,
      },
      {
        runIngestion: async () => {
          attempts += 1;
          if (attempts === 1) {
            throw new Error("postgresql://user:secret@localhost/app");
          }
          return 0;
        },
        wait: async () => {
          if (attempts === 2) {
            controller.abort();
          }
        },
        stdout: vi.fn(),
        stderr,
      },
    );

    expect(attempts).toBe(2);
    expect(stderr).toHaveBeenCalledWith(
      "Ingestion attempt failed unexpectedly; retrying in 60 seconds",
    );
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(stderr).not.toHaveBeenCalledWith(expect.stringContaining("secret"));
  });

  test("finishes an active ingestion before stopping", async () => {
    const controller = new AbortController();
    let finishRun: (() => void) | undefined;
    const runStarted = new Promise<void>((resolve) => {
      finishRun = resolve;
    });
    let releaseRun: (() => void) | undefined;
    const runBlocked = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    const runIngestion = vi.fn(async () => {
      finishRun?.();
      await runBlocked;
      return 0;
    });
    const wait = vi.fn(async () => undefined);

    const worker = runIngestionWorker(
      {
        semester: "202608",
        department: "CMSC",
        intervalMs: 300_000,
        signal: controller.signal,
      },
      { runIngestion, wait, stdout: vi.fn() },
    );

    await runStarted;
    controller.abort();
    releaseRun?.();
    await worker;

    expect(runIngestion).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  test("stops promptly when aborted during the delay", async () => {
    const controller = new AbortController();
    let delayStarted: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      delayStarted = resolve;
    });
    const runIngestion = vi.fn(async () => 0);

    const worker = runIngestionWorker(
      {
        semester: "202608",
        department: "CMSC",
        intervalMs: 300_000,
        signal: controller.signal,
      },
      {
        runIngestion,
        wait: async (_intervalMs, signal) => {
          delayStarted?.();
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
        },
        stdout: vi.fn(),
      },
    );

    await waiting;
    controller.abort();
    await worker;

    expect(runIngestion).toHaveBeenCalledTimes(1);
  });
});
