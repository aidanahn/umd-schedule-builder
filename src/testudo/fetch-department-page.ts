const TESTUDO_ORIGIN = "https://app.testudo.umd.edu";
const USER_AGENT = "umd-schedule-builder/0.1";

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

export async function fetchDepartmentPage(
  input: FetchDepartmentPageInput,
  options: FetchDepartmentPageOptions = {},
): Promise<FetchDepartmentPageResult> {
  const url = buildDepartmentUrl(input);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());

  const response = await fetchImpl(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": USER_AGENT,
    },
    redirect: "follow",
  });

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
