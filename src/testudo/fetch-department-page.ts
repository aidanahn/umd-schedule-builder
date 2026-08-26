const TESTUDO_ORIGIN = "https://app.testudo.umd.edu";

export type FetchDepartmentPageInput = {
  semester: string;
  department: string;
};

export type FetchDepartmentPageResult = {
  html: string;
  finalUrl: string;
  status: number;
  fetchedAt: string;
};

export type TestudoFetchErrorCode =
  | "INVALID_INPUT"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "HTTP_ERROR"
  | "RETRIES_EXHAUSTED"
  | "UNEXPECTED_CONTENT_TYPE"
  | "EMPTY_RESPONSE"
  | "AUTH_PAGE";

export class TestudoFetchError extends Error {
  constructor(
    public readonly code: TestudoFetchErrorCode,
    message: string,
    public readonly metadata: Readonly<{ status?: number; url?: string }> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "TestudoFetchError";
  }
}

export type FetchDepartmentPageOptions = {
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
  timeoutMs?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

function normalizeInput(input: FetchDepartmentPageInput) {
  if (!/^\d{6}$/.test(input.semester)) {
    throw new TestudoFetchError(
      "INVALID_INPUT",
      "semester must contain exactly six digits in YYYYMM format",
    );
  }

  if (!/^[A-Za-z]{4}$/.test(input.department)) {
    throw new TestudoFetchError(
      "INVALID_INPUT",
      "department must contain exactly four ASCII letters",
    );
  }

  return {
    semester: input.semester,
    department: input.department.toUpperCase(),
  };
}

export function buildDepartmentUrl(input: FetchDepartmentPageInput): string {
  const { semester, department } = normalizeInput(input);
  return new URL(`/soc/${semester}/${department}`, TESTUDO_ORIGIN).toString();
}

export async function fetchDepartmentPage(
  input: FetchDepartmentPageInput,
  options: FetchDepartmentPageOptions = {},
): Promise<FetchDepartmentPageResult> {
  buildDepartmentUrl(input);
  void options;
  throw new TestudoFetchError("NETWORK_ERROR", "fetch is not implemented");
}
