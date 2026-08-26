# Testudo Department Fetcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify a typed Node.js function that safely fetches one department page from UMD's public Testudo Schedule of Classes.

**Architecture:** A single focused module owns input validation, Testudo URL construction, bounded HTTP retries, timeout handling, and basic response validation. Its runtime dependencies (`fetch`, sleep, and clock) are injectable so unit tests are deterministic and never contact UMD; a separate opt-in integration test checks the live endpoint.

**Tech Stack:** Node.js 20+, TypeScript 5, Vitest, built-in Fetch API

**Spec:** `docs/superpowers/specs/2026-08-25-testudo-fetch-design.md`

## Global Constraints

- Initial live target: semester `202608`, department `CMSC`.
- The module must not parse course records, write files, poll seats, or send notifications.
- Use Node's built-in HTTP client; add no runtime HTTP dependency.
- Automated unit tests must make no external requests.
- Retry only HTTP `429`, HTTP `5xx`, and transient network failures.
- Each retry policy must have a finite attempt count and bounded delay.
- Never include a full upstream response body in an error.

## File Map

- `package.json`: Node version requirement and scripts for unit tests, live tests, type checking, and the full verification suite.
- `tsconfig.json`: strict TypeScript configuration for source and tests.
- `.gitignore`: generated dependency, coverage, and build artifacts.
- `src/testudo/fetch-department-page.ts`: public types, typed errors, input normalization, URL construction, HTTP behavior, retries, and response validation.
- `src/testudo/fetch-department-page.test.ts`: deterministic unit tests with injected HTTP and timing dependencies.
- `src/testudo/fetch-department-page.integration.test.ts`: opt-in request to the official `202608/CMSC` Testudo page.

---

### Task 1: Project Scaffold, Input Validation, and URL Construction

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `src/testudo/fetch-department-page.ts`
- Test: `src/testudo/fetch-department-page.test.ts`

**Interfaces:**
- Consumes: Node.js 20 global `fetch`, `Response`, and `AbortSignal` types.
- Produces: `FetchDepartmentPageInput`, `FetchDepartmentPageResult`, `FetchDepartmentPageOptions`, `TestudoFetchError`, `buildDepartmentUrl(input)`, and `fetchDepartmentPage(input, options?)`.

- [ ] **Step 1: Create the TypeScript/Vitest project configuration**

Create `package.json`:

```json
{
  "name": "umd-schedule-builder",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "test": "vitest run --exclude '**/*.integration.test.ts'",
    "test:live": "RUN_LIVE_TESTS=true vitest run src/testudo/fetch-department-page.integration.test.ts",
    "typecheck": "tsc --noEmit",
    "check": "npm run typecheck && npm test"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  }
}
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts"]
}
```

Create `.gitignore`:

```gitignore
node_modules/
coverage/
dist/
*.tsbuildinfo
```

- [ ] **Step 2: Install development dependencies**

Run: `npm install`

Expected: npm creates `node_modules/` and `package-lock.json` without adding runtime dependencies.

- [ ] **Step 3: Write failing validation and URL tests**

Create `src/testudo/fetch-department-page.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  buildDepartmentUrl,
  fetchDepartmentPage,
  TestudoFetchError,
} from "./fetch-department-page.js";

describe("buildDepartmentUrl", () => {
  it("builds the official URL and normalizes the department", () => {
    expect(
      buildDepartmentUrl({ semester: "202608", department: "cmsc" }),
    ).toBe("https://app.testudo.umd.edu/soc/202608/CMSC");
  });

  it.each([
    [{ semester: "20268", department: "CMSC" }, "semester"],
    [{ semester: "2026FA", department: "CMSC" }, "semester"],
    [{ semester: "202608", department: "CS" }, "department"],
    [{ semester: "202608", department: "CS1C" }, "department"],
  ])("rejects invalid input %#", (input, field) => {
    expect(() => buildDepartmentUrl(input)).toThrowError(TestudoFetchError);
    expect(() => buildDepartmentUrl(input)).toThrow(field);
  });

  it("rejects invalid input before calling fetch", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      fetchDepartmentPage(
        { semester: "fall-2026", department: "CMSC" },
        { fetchImpl },
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run the focused test and verify it fails**

Run: `npm test -- src/testudo/fetch-department-page.test.ts`

Expected: FAIL because `fetch-department-page.ts` does not exist.

- [ ] **Step 5: Implement public types, typed errors, and URL validation**

Create `src/testudo/fetch-department-page.ts` with these initial definitions:

```ts
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
```

- [ ] **Step 6: Run validation tests**

Run: `npm test -- src/testudo/fetch-department-page.test.ts`

Expected: all four validation/URL test cases PASS.

- [ ] **Step 7: Type-check the scaffold**

Run: `npm run typecheck`

Expected: PASS with no TypeScript errors.

- [ ] **Step 8: Commit the scaffold and validated URL builder**

```bash
git add package.json package-lock.json tsconfig.json .gitignore src/testudo/fetch-department-page.ts src/testudo/fetch-department-page.test.ts
git commit -m "feat: scaffold Testudo fetch module"
```

---

### Task 2: Successful Fetch and Response Validation

**Files:**
- Modify: `src/testudo/fetch-department-page.ts`
- Test: `src/testudo/fetch-department-page.test.ts`

**Interfaces:**
- Consumes: `fetchDepartmentPage(input, options?)`, `TestudoFetchError`, and injected `fetchImpl` from Task 1.
- Produces: successful `FetchDepartmentPageResult` and stable response-validation errors.

- [ ] **Step 1: Add failing successful-response tests**

Append inside a new `describe("fetchDepartmentPage", ...)` block:

```ts
const input = { semester: "202608", department: "CMSC" };

it("fetches HTML with identifiable headers and returns metadata", async () => {
  const html = "<!doctype html><html><title>Schedule of Classes</title></html>";
  const response = new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=UTF-8" },
  });
  Object.defineProperty(response, "url", {
    value: "https://app.testudo.umd.edu/soc/202608/CMSC",
  });
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);

  await expect(
    fetchDepartmentPage(input, {
      fetchImpl,
      now: () => new Date("2026-08-25T22:30:00.000Z"),
    }),
  ).resolves.toEqual({
    html,
    finalUrl: "https://app.testudo.umd.edu/soc/202608/CMSC",
    status: 200,
    fetchedAt: "2026-08-25T22:30:00.000Z",
  });

  const [url, init] = fetchImpl.mock.calls[0]!;
  expect(url).toBe("https://app.testudo.umd.edu/soc/202608/CMSC");
  expect(new Headers(init?.headers).get("accept")).toContain("text/html");
  expect(new Headers(init?.headers).get("user-agent")).toContain(
    "umd-schedule-builder",
  );
  expect(init?.redirect).toBe("follow");
});
```

- [ ] **Step 2: Add failing content-rejection tests**

Append these table-driven cases:

```ts
it.each([
  [
    new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    "UNEXPECTED_CONTENT_TYPE",
  ],
  [
    new Response("   ", {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
    "EMPTY_RESPONSE",
  ],
  [
    new Response("<html><title>Central Authentication Service</title></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
    "AUTH_PAGE",
  ],
])("rejects invalid successful content with %s", async (response, code) => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
  await expect(
    fetchDepartmentPage(input, { fetchImpl }),
  ).rejects.toMatchObject({ code });
});

it("rejects a non-retryable HTTP error without exposing its body", async () => {
  const secretBody = "upstream page body must not appear in errors";
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(secretBody, {
      status: 404,
      headers: { "content-type": "text/html" },
    }),
  );

  const error = await fetchDepartmentPage(input, { fetchImpl }).catch(
    (caught: unknown) => caught,
  );
  expect(error).toMatchObject({ code: "HTTP_ERROR", metadata: { status: 404 } });
  expect(String(error)).not.toContain(secretBody);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 3: Run focused tests and verify the new cases fail**

Run: `npm test -- src/testudo/fetch-department-page.test.ts`

Expected: validation tests PASS; new fetch tests FAIL with the temporary `NETWORK_ERROR`.

- [ ] **Step 4: Implement one-attempt fetch and response validation**

Add constants and helpers above `fetchDepartmentPage`:

```ts
const USER_AGENT = "umd-schedule-builder/0.1";

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
```

Replace the temporary body of `fetchDepartmentPage` with a one-attempt implementation (Task 3 will add retries and timeout):

```ts
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
```

- [ ] **Step 5: Run success and content-validation tests**

Run: `npm test -- src/testudo/fetch-department-page.test.ts`

Expected: all Task 1 and Task 2 tests PASS.

- [ ] **Step 6: Run type checking**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit successful retrieval and validation**

```bash
git add src/testudo/fetch-department-page.ts src/testudo/fetch-department-page.test.ts
git commit -m "feat: fetch and validate Testudo HTML"
```

---

### Task 3: Bounded Retries, Timeout, and Live Verification

**Files:**
- Modify: `src/testudo/fetch-department-page.ts`
- Modify: `src/testudo/fetch-department-page.test.ts`
- Create: `src/testudo/fetch-department-page.integration.test.ts`

**Interfaces:**
- Consumes: the Task 2 `fetchDepartmentPage` response-validation behavior.
- Produces: bounded retry/timeout behavior and the `npm run test:live` verification command.

- [ ] **Step 1: Add failing transient-HTTP retry tests**

Append these cases inside the fetcher describe block:

```ts
it.each([429, 500, 503])("retries transient HTTP %i responses", async (status) => {
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response("busy", {
        status,
        headers: { "content-type": "text/html" },
      }),
    )
    .mockResolvedValueOnce(
      new Response("<html>Schedule of Classes</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
  const sleep = vi.fn(async () => undefined);

  await expect(
    fetchDepartmentPage(input, { fetchImpl, sleep }),
  ).resolves.toMatchObject({ status: 200 });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(sleep).toHaveBeenCalledTimes(1);
});

it("throws RETRIES_EXHAUSTED after the final transient HTTP response", async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
    new Response("busy", {
      status: 503,
      headers: { "content-type": "text/html" },
    }),
  );

  await expect(
    fetchDepartmentPage(input, {
      fetchImpl,
      sleep: async () => undefined,
      maxAttempts: 3,
    }),
  ).rejects.toMatchObject({
    code: "RETRIES_EXHAUSTED",
    metadata: { status: 503 },
  });
  expect(fetchImpl).toHaveBeenCalledTimes(3);
});
```

- [ ] **Step 2: Add failing backoff and `Retry-After` tests**

Append:

```ts
it("uses bounded exponential backoff", async () => {
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response("busy", { status: 500 }))
    .mockResolvedValueOnce(new Response("busy", { status: 500 }))
    .mockResolvedValueOnce(
      new Response("<html>ok</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
  const sleep = vi.fn(async () => undefined);

  await fetchDepartmentPage(input, {
    fetchImpl,
    sleep,
    baseDelayMs: 600,
    maxDelayMs: 1_000,
  });
  expect(sleep.mock.calls).toEqual([[600], [1_000]]);
});

it("honors a numeric Retry-After header within the delay cap", async () => {
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response("slow down", {
        status: 429,
        headers: { "retry-after": "2" },
      }),
    )
    .mockResolvedValueOnce(
      new Response("<html>ok</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
  const sleep = vi.fn(async () => undefined);

  await fetchDepartmentPage(input, { fetchImpl, sleep, maxDelayMs: 5_000 });
  expect(sleep).toHaveBeenCalledWith(2_000);
});
```

- [ ] **Step 3: Add failing timeout and network-failure tests**

Append:

```ts
it("retries network failures and reports NETWORK_ERROR after exhaustion", async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline"));

  await expect(
    fetchDepartmentPage(input, {
      fetchImpl,
      sleep: async () => undefined,
      maxAttempts: 2,
    }),
  ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it("aborts a stalled request and reports TIMEOUT after exhaustion", async () => {
  vi.useFakeTimers();
  const fetchImpl = vi.fn<typeof fetch>((_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      );
    }),
  );
  const promise = fetchDepartmentPage(input, {
    fetchImpl,
    sleep: async () => undefined,
    timeoutMs: 50,
    maxAttempts: 1,
  });
  const assertion = expect(promise).rejects.toMatchObject({ code: "TIMEOUT" });

  await vi.advanceTimersByTimeAsync(50);
  await assertion;
  vi.useRealTimers();
});
```

- [ ] **Step 4: Run focused tests and verify the retry cases fail**

Run: `npm test -- src/testudo/fetch-department-page.test.ts`

Expected: Task 1 and Task 2 cases PASS; retry, backoff, timeout, and network-final-error cases FAIL.

- [ ] **Step 5: Implement retry classification and bounded delay helpers**

Add these defaults and helpers:

```ts
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 5_000;

const defaultSleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function retryAfterMs(response: Response, now: Date): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;

  if (/^\d+$/.test(value)) return Number(value) * 1_000;
  const retryAt = Date.parse(value);
  return Number.isNaN(retryAt) ? undefined : Math.max(0, retryAt - now.getTime());
}

function retryDelayMs(
  response: Response | undefined,
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  now: Date,
): number {
  const requested = response ? retryAfterMs(response, now) : undefined;
  return Math.min(requested ?? baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TestudoFetchError("INVALID_INPUT", `${name} must be a positive integer`);
  }
  return value;
}
```

- [ ] **Step 6: Replace one-attempt retrieval with the bounded attempt loop**

Inside `fetchDepartmentPage`, resolve and validate options, then implement this control flow around the Task 2 response handling:

```ts
const url = buildDepartmentUrl(input);
const fetchImpl = options.fetchImpl ?? globalThis.fetch;
const sleep = options.sleep ?? defaultSleep;
const now = options.now ?? (() => new Date());
const timeoutMs = positiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "timeoutMs");
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
      if (!response.ok) validateResponse(response, "");
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
    if (error instanceof TestudoFetchError) throw error;
    lastFailure = error;
    lastWasTimeout = controller.signal.aborted;
    if (attempt === maxAttempts) break;
  } finally {
    clearTimeout(timeout);
  }

  await sleep(
    retryDelayMs(response, attempt, baseDelayMs, maxDelayMs, now()),
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
```

- [ ] **Step 7: Run unit tests and type checking**

Run: `npm run check`

Expected: all unit tests PASS and TypeScript reports no errors.

- [ ] **Step 8: Add the opt-in live integration test**

Create `src/testudo/fetch-department-page.integration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fetchDepartmentPage } from "./fetch-department-page.js";

const live = process.env.RUN_LIVE_TESTS === "true";

describe.skipIf(!live)("Testudo live integration", () => {
  it(
    "fetches Fall 2026 CMSC HTML from the official endpoint",
    async () => {
      const result = await fetchDepartmentPage({
        semester: "202608",
        department: "CMSC",
      });

      expect(result.status).toBe(200);
      expect(result.finalUrl).toContain(
        "app.testudo.umd.edu/soc/202608/CMSC",
      );
      expect(result.html).toContain("CMSC");
      expect(result.html).toMatch(/Schedule of Classes/i);
    },
    20_000,
  );
});
```

- [ ] **Step 9: Verify default checks remain offline and pass**

Run: `npm run check`

Expected: type checking passes and unit tests pass without running the integration test.

- [ ] **Step 10: Run the single live Testudo check**

Run: `npm run test:live`

Expected: one integration test passes against `https://app.testudo.umd.edu/soc/202608/CMSC`, returns HTTP 200 HTML, and contains the CMSC schedule markers.

- [ ] **Step 11: Commit retry behavior and live verification**

```bash
git add src/testudo/fetch-department-page.ts src/testudo/fetch-department-page.test.ts src/testudo/fetch-department-page.integration.test.ts
git commit -m "feat: harden Testudo fetch retries"
```

---

### Task 4: Final Acceptance Verification

**Files:**
- Modify only if verification exposes a defect in files created by Tasks 1-3.

**Interfaces:**
- Consumes: all project scripts and fetcher interfaces from Tasks 1-3.
- Produces: evidence that the fetch-only milestone satisfies the approved spec.

- [ ] **Step 1: Run the full offline verification suite**

Run: `npm run check`

Expected: TypeScript exits successfully and all unit tests pass.

- [ ] **Step 2: Run the opt-in live verification once more**

Run: `npm run test:live`

Expected: the one live CMSC `202608` Testudo fetch passes.

- [ ] **Step 3: Check repository hygiene and scope**

Run: `git status --short && git diff --check && git log --oneline --decorate -4`

Expected: no uncommitted implementation changes, no whitespace errors, and three focused implementation commits after the design/plan commits. Confirm no parser, persistence, notification, or website files exist.
