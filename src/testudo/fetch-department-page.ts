const TESTUDO_ORIGIN = "https://app.testudo.umd.edu";
const USER_AGENT = "umd-schedule-builder/0.1";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 5_000;

export type FetchDepartmentPageInput = {
  semester: string;
  department: string;
};

export type FetchDepartmentSectionsInput = {
  semester: string;
  courseIds: string[];
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

export function buildSectionsUrl(input: FetchDepartmentSectionsInput): string {
  if (!/^\d{6}$/.test(input.semester)) {
    throw new TestudoFetchError(
      "INVALID_INPUT",
      "semester must contain exactly six digits in YYYYMM format",
    );
  }

  const courseIds = [
    ...new Set(input.courseIds.map((courseId) => courseId.toUpperCase())),
  ];
  if (
    courseIds.length === 0 ||
    courseIds.some((courseId) => !/^[A-Z]{4}\d{3}[A-Z]?$/.test(courseId))
  ) {
    throw new TestudoFetchError(
      "INVALID_INPUT",
      "courseIds must contain at least one valid Testudo course ID",
    );
  }

  const url = new URL(`/soc/${input.semester}/sections`, TESTUDO_ORIGIN);
  for (const courseId of courseIds) {
    url.searchParams.append("courseIds", courseId);
  }
  return url.toString();
}

function isAuthenticationPage(html: string, finalUrl: string): boolean {
  const pathname = finalUrl ? new URL(finalUrl).pathname : "";

  return (
    /(?:login|cas|authenticate)/i.test(pathname) ||
    /<title[^>]*>[^<]*(?:login|sign in|central authentication service)/i.test(
      html,
    )
  );
}

function validateResponse(response: Response, html: string): void {
  const metadata = { status: response.status, url: response.url };

  if (!response.ok) {
    throw new TestudoFetchError(
      "HTTP_ERROR",
      `Testudo returned HTTP ${response.status}`,
      metadata,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!/^text\/html(?:;|$)/i.test(contentType)) {
    throw new TestudoFetchError(
      "UNEXPECTED_CONTENT_TYPE",
      "Testudo returned a non-HTML response",
      metadata,
    );
  }

  if (html.trim().length === 0) {
    throw new TestudoFetchError(
      "EMPTY_RESPONSE",
      "Testudo returned an empty HTML response",
      metadata,
    );
  }

  if (isAuthenticationPage(html, response.url)) {
    throw new TestudoFetchError(
      "AUTH_PAGE",
      "Testudo returned an authentication page",
      metadata,
    );
  }
}

const defaultSleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function parseRetryAfter(response: Response, now: Date): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) {
    return undefined;
  }

  if (/^\d+$/.test(value)) {
    return Number(value) * 1_000;
  }

  const retryAt = Date.parse(value);
  return Number.isNaN(retryAt) ? undefined : Math.max(0, retryAt - now.getTime());
}

function getRetryDelay(
  response: Response | undefined,
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  now: Date,
): number {
  const requestedDelay = response
    ? parseRetryAfter(response, now)
    : undefined;
  const exponentialDelay = baseDelayMs * 2 ** (attempt - 1);

  return Math.min(requestedDelay ?? exponentialDelay, maxDelayMs);
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TestudoFetchError(
      "INVALID_INPUT",
      `${name} must be a positive integer`,
    );
  }

  return value;
}

export async function fetchTestudoPage(
  url: string,
  options: FetchDepartmentPageOptions = {},
): Promise<FetchDepartmentPageResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? (() => new Date());
  const timeoutMs = positiveInteger(
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    "timeoutMs",
  );
  const maxAttempts = positiveInteger(
    options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    "maxAttempts",
  );
  const baseDelayMs = positiveInteger(
    options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
    "baseDelayMs",
  );
  const maxDelayMs = positiveInteger(
    options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
    "maxDelayMs",
  );

  let lastFailure: unknown;
  let lastWasTimeout = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response | undefined;

    try {
      response = await fetchImpl(url, {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": USER_AGENT,
        },
        redirect: "follow",
        signal: controller.signal,
      });

      if (isTransientStatus(response.status)) {
        lastFailure = response;

        if (attempt === maxAttempts) {
          throw new TestudoFetchError(
            "RETRIES_EXHAUSTED",
            `Testudo remained unavailable after ${maxAttempts} attempts`,
            { status: response.status, url: response.url || url },
          );
        }
      } else {
        if (!response.ok) {
          validateResponse(response, "");
        }

        const html = await response.text();
        validateResponse(response, html);

        return {
          html,
          finalUrl: response.url || url,
          status: response.status,
          fetchedAt: now().toISOString(),
        };
      }
    } catch (error) {
      if (error instanceof TestudoFetchError) {
        throw error;
      }

      lastFailure = error;
      lastWasTimeout = controller.signal.aborted;

      if (attempt === maxAttempts) {
        break;
      }
    } finally {
      clearTimeout(timeout);
    }

    await sleep(
      getRetryDelay(response, attempt, baseDelayMs, maxDelayMs, now()),
    );
  }

  throw new TestudoFetchError(
    lastWasTimeout ? "TIMEOUT" : "NETWORK_ERROR",
    lastWasTimeout
      ? `Testudo request timed out after ${maxAttempts} attempt(s)`
      : `Testudo request failed after ${maxAttempts} attempt(s)`,
    { url },
    { cause: lastFailure },
  );
}

export async function fetchDepartmentPage(
  input: FetchDepartmentPageInput,
  options: FetchDepartmentPageOptions = {},
): Promise<FetchDepartmentPageResult> {
  return await fetchTestudoPage(buildDepartmentUrl(input), options);
}

export async function fetchDepartmentSections(
  input: FetchDepartmentSectionsInput,
  options: FetchDepartmentPageOptions = {},
): Promise<FetchDepartmentPageResult> {
  return await fetchTestudoPage(buildSectionsUrl(input), options);
}
