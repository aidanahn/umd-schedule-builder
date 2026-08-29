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

  test.each(["not a URL", "https://localhost/app", "postgresql://localhost"])(
    "rejects invalid PostgreSQL URL %s without exposing it",
    (value) => {
      let thrown: unknown;

      try {
        resolveDatabaseUrl({ DATABASE_URL: value });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toMatchObject({
        name: "DatabaseConfigurationError",
        code: "DATABASE_URL_INVALID",
        message: "DATABASE_URL must be a valid PostgreSQL URL",
      });
      expect(String(thrown)).not.toContain(value);
    },
  );
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
