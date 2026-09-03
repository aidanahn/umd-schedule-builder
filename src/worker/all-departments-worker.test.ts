import { describe, expect, it, vi } from "vitest";

import { runAllDepartmentsWorker } from "./all-departments-worker.js";

describe("runAllDepartmentsWorker", () => {
  it("runs a fresh complete cycle after every interval", async () => {
    const controller = new AbortController();
    const sequence: string[] = [];
    const runCycle = vi.fn(async (input) => {
      sequence.push(`cycle:${input.semester}:${input.departmentDelayMs}`);
      return 0;
    });
    const wait = vi.fn(async (intervalMs: number) => {
      sequence.push(`wait:${intervalMs}`);
      if (wait.mock.calls.length === 2) controller.abort();
    });

    await runAllDepartmentsWorker(
      {
        semester: "202608",
        departmentDelayMs: 5_000,
        intervalMs: 300_000,
        signal: controller.signal,
      },
      { runCycle, wait },
    );

    expect(sequence).toEqual([
      "cycle:202608:5000",
      "wait:300000",
      "cycle:202608:5000",
      "wait:300000",
    ]);
    expect(runCycle).toHaveBeenCalledTimes(2);
  });

  it("continues after a failed cycle without leaking unexpected errors", async () => {
    const controller = new AbortController();
    const stderr = vi.fn();
    const runCycle = vi
      .fn()
      .mockRejectedValueOnce(new Error("secret"))
      .mockResolvedValueOnce(0);
    const wait = vi.fn(async () => {
      if (wait.mock.calls.length === 2) controller.abort();
    });

    await runAllDepartmentsWorker(
      {
        semester: "202608",
        departmentDelayMs: 0,
        intervalMs: 60_000,
        signal: controller.signal,
      },
      { runCycle, wait, stderr },
    );

    expect(runCycle).toHaveBeenCalledTimes(2);
    expect(stderr).toHaveBeenCalledWith(
      "Catalog ingestion cycle failed unexpectedly; retrying in 60 seconds",
    );
    expect(JSON.stringify(stderr.mock.calls)).not.toContain("secret");
  });
});
