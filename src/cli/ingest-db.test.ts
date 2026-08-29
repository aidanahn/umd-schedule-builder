import { describe, expect, test, vi } from "vitest";

import type { AppDatabase } from "../db/connection.js";
import { SnapshotPersistenceError } from "../db/snapshot-records.js";
import type { DepartmentSnapshot } from "../testudo/build-department-snapshot.js";
import { runDatabaseIngestion } from "./ingest-db.js";

const snapshot: DepartmentSnapshot = {
  schemaVersion: 1,
  semester: "202608",
  department: "CMSC",
  collectedAt: "2026-08-29T12:00:00.000Z",
  sourceUrl: "https://app.testudo.umd.edu/soc/202608/CMSC",
  status: "complete",
  summary: {
    coursesFound: 0,
    coursesParsed: 0,
    coursesFailed: 0,
    sectionsParsed: 0,
  },
  courses: [],
  warnings: [],
  failures: [],
};

function dependencies() {
  const db = {} as AppDatabase;
  const close = vi.fn(async () => undefined);
  const collect = vi.fn().mockResolvedValue(snapshot);
  const connect = vi.fn(() => ({ db, close }));
  const persist = vi.fn().mockResolvedValue({
    ingestionId: "00000000-0000-4000-8000-000000000001",
    previousIngestionId: null,
    alreadyPersisted: false,
    observationsInserted: 2,
    eventsInserted: 3,
  });
  const stdout = vi.fn();
  const stderr = vi.fn();

  return { db, close, collect, connect, persist, stdout, stderr };
}

describe("runDatabaseIngestion", () => {
  test.each([
    [[], "--semester is required"],
    [
      ["--semester", "202608"],
      "--department is required",
    ],
    [
      ["--semester", "fall", "--department", "CMSC"],
      "semester must contain exactly six digits",
    ],
  ])("rejects invalid arguments before connecting %#", async (argv, message) => {
    const options = dependencies();

    await expect(runDatabaseIngestion(argv, options)).resolves.toBe(2);

    expect(options.stderr).toHaveBeenCalledWith(message);
    expect(options.collect).not.toHaveBeenCalled();
    expect(options.connect).not.toHaveBeenCalled();
  });

  test("persists the collected snapshot and closes the connection", async () => {
    const options = dependencies();

    await expect(
      runDatabaseIngestion(
        ["--semester", "202608", "--department", "cmsc"],
        options,
      ),
    ).resolves.toBe(0);

    expect(options.collect).toHaveBeenCalledWith({
      semester: "202608",
      department: "CMSC",
    });
    expect(options.persist).toHaveBeenCalledWith(options.db, snapshot);
    expect(options.stdout).toHaveBeenCalledWith(
      "Persisted ingestion 00000000-0000-4000-8000-000000000001 (2 observations, 3 events)",
    );
    expect(options.stderr).not.toHaveBeenCalled();
    expect(options.close).toHaveBeenCalledTimes(1);
  });

  test("reports an exact retry", async () => {
    const options = dependencies();
    options.persist.mockResolvedValue({
      ingestionId: "00000000-0000-4000-8000-000000000001",
      previousIngestionId: null,
      alreadyPersisted: true,
      observationsInserted: 0,
      eventsInserted: 0,
    });

    await expect(
      runDatabaseIngestion(
        ["--semester", "202608", "--department", "CMSC"],
        options,
      ),
    ).resolves.toBe(0);
    expect(options.stdout).toHaveBeenCalledWith(
      "Ingestion 00000000-0000-4000-8000-000000000001 already persisted",
    );
    expect(options.close).toHaveBeenCalledTimes(1);
  });

  test("reports collection failure without creating a connection", async () => {
    const options = dependencies();
    options.collect.mockRejectedValue(new Error("Testudo unavailable"));

    await expect(
      runDatabaseIngestion(
        ["--semester", "202608", "--department", "CMSC"],
        options,
      ),
    ).resolves.toBe(1);
    expect(options.stderr).toHaveBeenCalledWith("Testudo unavailable");
    expect(options.connect).not.toHaveBeenCalled();
  });

  test("sanitizes an unexpected connection failure", async () => {
    const options = dependencies();
    options.connect.mockImplementation(() => {
      throw new Error("postgresql://user:secret@localhost/app");
    });

    await expect(
      runDatabaseIngestion(
        ["--semester", "202608", "--department", "CMSC"],
        options,
      ),
    ).resolves.toBe(1);
    expect(options.stderr).toHaveBeenCalledWith("Database connection failed");
    expect(options.stderr).not.toHaveBeenCalledWith(
      expect.stringContaining("secret"),
    );
  });

  test("closes the connection after a persistence failure", async () => {
    const options = dependencies();
    options.persist.mockRejectedValue(
      new SnapshotPersistenceError(
        "PERSISTENCE_FAILED",
        "Database ingestion failed",
      ),
    );

    await expect(
      runDatabaseIngestion(
        ["--semester", "202608", "--department", "CMSC"],
        options,
      ),
    ).resolves.toBe(1);
    expect(options.stderr).toHaveBeenCalledWith("Database ingestion failed");
    expect(options.close).toHaveBeenCalledTimes(1);
  });

  test("reports connection cleanup failure without exposing driver details", async () => {
    const options = dependencies();
    options.close.mockRejectedValue(
      new Error("postgresql://user:secret@localhost/app"),
    );

    await expect(
      runDatabaseIngestion(
        ["--semester", "202608", "--department", "CMSC"],
        options,
      ),
    ).resolves.toBe(1);
    expect(options.stderr).toHaveBeenCalledWith(
      "Database connection cleanup failed",
    );
    expect(options.stderr).not.toHaveBeenCalledWith(
      expect.stringContaining("secret"),
    );
  });
});
