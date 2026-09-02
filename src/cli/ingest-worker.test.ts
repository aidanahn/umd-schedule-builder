import { describe, expect, test, vi } from "vitest";

import {
  parseIngestionWorkerArgs,
  registerIngestionWorkerShutdown,
  runIngestionWorkerCommand,
} from "./ingest-worker.js";

describe("parseIngestionWorkerArgs", () => {
  test("normalizes CLI input and defaults to a five-minute interval", () => {
    expect(
      parseIngestionWorkerArgs(
        ["--semester", "202608", "--department", "cmsc"],
        {},
      ),
    ).toEqual({
      semester: "202608",
      department: "CMSC",
      intervalMs: 300_000,
    });
  });

  test("accepts environment configuration", () => {
    expect(
      parseIngestionWorkerArgs([], {
        INGEST_SEMESTER: "202608",
        INGEST_DEPARTMENT: "cmsc",
        INGEST_INTERVAL_SECONDS: "600",
      }),
    ).toEqual({
      semester: "202608",
      department: "CMSC",
      intervalMs: 600_000,
    });
  });

  test("prefers CLI values over environment values", () => {
    expect(
      parseIngestionWorkerArgs(
        [
          "--semester",
          "202608",
          "--department",
          "CMSC",
          "--interval-seconds",
          "120",
        ],
        {
          INGEST_SEMESTER: "202701",
          INGEST_DEPARTMENT: "MATH",
          INGEST_INTERVAL_SECONDS: "900",
        },
      ),
    ).toEqual({
      semester: "202608",
      department: "CMSC",
      intervalMs: 120_000,
    });
  });

  test.each([
    [{}, "--semester or INGEST_SEMESTER is required"],
    [
      { INGEST_SEMESTER: "202608" },
      "--department or INGEST_DEPARTMENT is required",
    ],
    [
      {
        INGEST_SEMESTER: "202608",
        INGEST_DEPARTMENT: "CMSC",
        INGEST_INTERVAL_SECONDS: "fast",
      },
      "ingestion interval must be an integer of at least 60 seconds",
    ],
    [
      {
        INGEST_SEMESTER: "202608",
        INGEST_DEPARTMENT: "CMSC",
        INGEST_INTERVAL_SECONDS: "30",
      },
      "ingestion interval must be an integer of at least 60 seconds",
    ],
  ])("rejects invalid environment configuration %#", (env, message) => {
    expect(() => parseIngestionWorkerArgs([], env)).toThrow(message);
  });
});

describe("runIngestionWorkerCommand", () => {
  test("rejects invalid configuration before starting the worker", async () => {
    const runWorker = vi.fn();
    const stderr = vi.fn();

    await expect(
      runIngestionWorkerCommand([], {
        env: {},
        signal: new AbortController().signal,
        runWorker,
        stderr,
      }),
    ).resolves.toBe(2);

    expect(runWorker).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(
      "--semester or INGEST_SEMESTER is required",
    );
  });

  test("runs repeated attempts through the existing database ingestion path", async () => {
    const signal = new AbortController().signal;
    const runDatabaseIngestion = vi.fn().mockResolvedValue(0);
    const stdout = vi.fn();
    const stderr = vi.fn();
    const runWorker = vi.fn(async (config, dependencies) => {
      expect(config).toEqual({
        semester: "202608",
        department: "CMSC",
        intervalMs: 300_000,
        signal,
      });
      await dependencies.runIngestion({
        semester: "202608",
        department: "CMSC",
      });
    });

    await expect(
      runIngestionWorkerCommand(
        ["--semester", "202608", "--department", "cmsc"],
        {
          env: {},
          signal,
          runDatabaseIngestion,
          runWorker,
          stdout,
          stderr,
        },
      ),
    ).resolves.toBe(0);

    expect(runDatabaseIngestion).toHaveBeenCalledWith(
      ["--semester", "202608", "--department", "CMSC"],
      { stdout, stderr },
    );
  });

  test("sanitizes an unexpected worker failure", async () => {
    const stderr = vi.fn();

    await expect(
      runIngestionWorkerCommand(
        ["--semester", "202608", "--department", "CMSC"],
        {
          env: {},
          signal: new AbortController().signal,
          runWorker: async () => {
            throw new Error("postgresql://user:secret@localhost/app");
          },
          stderr,
        },
      ),
    ).resolves.toBe(1);

    expect(stderr).toHaveBeenCalledWith("Ingestion worker failed");
    expect(stderr).not.toHaveBeenCalledWith(expect.stringContaining("secret"));
  });
});

describe("registerIngestionWorkerShutdown", () => {
  test.each(["SIGINT", "SIGTERM"] as const)(
    "aborts on %s and removes both handlers during cleanup",
    (shutdownSignal) => {
      const listeners = new Map<string, () => void>();
      const target = {
        once(signal: string, listener: () => void) {
          listeners.set(signal, listener);
        },
        off(signal: string, listener: () => void) {
          if (listeners.get(signal) === listener) {
            listeners.delete(signal);
          }
        },
      };
      const controller = new AbortController();

      const cleanup = registerIngestionWorkerShutdown(target, controller);
      listeners.get(shutdownSignal)?.();

      expect(controller.signal.aborted).toBe(true);
      cleanup();
      expect([...listeners.keys()]).toEqual([]);
    },
  );
});
