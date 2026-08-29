import { describe, expect, test } from "vitest";

import { assertTestDatabaseUrl } from "./test-database-url.js";

describe("assertTestDatabaseUrl", () => {
  test("accepts a database name ending in _test", () => {
    expect(assertTestDatabaseUrl("postgresql://localhost/app_test")).toBe(
      "postgresql://localhost/app_test",
    );
  });

  test("accepts an encoded test database name", () => {
    expect(assertTestDatabaseUrl("postgresql://localhost/app%5Ftest")).toBe(
      "postgresql://localhost/app%5Ftest",
    );
  });

  test("rejects a database name without the _test suffix", () => {
    expect(() =>
      assertTestDatabaseUrl("postgresql://localhost/app"),
    ).toThrowError("TEST_DATABASE_URL database name must end in _test");
  });

  test("rejects a missing test database URL", () => {
    expect(() => assertTestDatabaseUrl(undefined)).toThrowError(
      "TEST_DATABASE_URL is required",
    );
  });

  test("rejects an invalid URL without exposing it", () => {
    const secret = "not-a-url-with-secret";

    expect(() => assertTestDatabaseUrl(secret)).toThrowError(
      "TEST_DATABASE_URL must be a valid URL",
    );

    try {
      assertTestDatabaseUrl(secret);
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
