import { Pool } from "pg";
import { describe, expect, test, vi } from "vitest";

import {
  createDatabaseConnection,
  DatabaseConfigurationError,
  resolveDatabaseUrl,
} from "./connection.js";

describe("resolveDatabaseUrl", () => {
  test("rejects a missing database URL", () => {
    expect(() => resolveDatabaseUrl({})).toThrowError(
      new DatabaseConfigurationError("DATABASE_URL is required"),
    );
  });

  test("rejects a blank database URL", () => {
    expect(() => resolveDatabaseUrl({ DATABASE_URL: "  " })).toThrowError(
      "DATABASE_URL is required",
    );
  });

  test("returns the configured database URL", () => {
    expect(
      resolveDatabaseUrl({ DATABASE_URL: "postgresql://localhost/app" }),
    ).toBe("postgresql://localhost/app");
  });
});

describe("createDatabaseConnection", () => {
  test("constructs a pool without connecting and closes it once", async () => {
    const pool = new Pool({ connectionString: "postgresql://localhost/app" });
    const end = vi.spyOn(pool, "end");

    const connection = createDatabaseConnection({
      connectionString: "postgresql://localhost/app",
      poolFactory: () => pool,
    });

    expect(connection.pool).toBe(pool);
    expect(pool.totalCount).toBe(0);

    await connection.close();
    await connection.close();

    expect(end).toHaveBeenCalledTimes(1);
  });
});
