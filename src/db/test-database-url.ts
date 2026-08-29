export function assertTestDatabaseUrl(value: string | undefined): string {
  if (!value?.trim()) {
    throw new Error("TEST_DATABASE_URL is required");
  }

  let databaseName: string;

  try {
    const url = new URL(value);
    const finalPathSegment = url.pathname.split("/").filter(Boolean).at(-1);
    databaseName = decodeURIComponent(finalPathSegment ?? "");
  } catch {
    throw new Error("TEST_DATABASE_URL must be a valid URL");
  }

  if (!databaseName.endsWith("_test")) {
    throw new Error("TEST_DATABASE_URL database name must end in _test");
  }

  return value;
}
