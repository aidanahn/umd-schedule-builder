# Testudo Department Fetch Design

## Goal

Build the first production-oriented ingestion component for a UMD schedule-builder MVP: a Node.js and TypeScript function that retrieves the public Testudo Schedule of Classes HTML for one department in one semester.

The initial target is department `CMSC` in semester `202608`. Both values remain function inputs so later work can cover other departments and semesters without changing the fetch layer.

## Scope

This milestone retrieves and validates an HTTP response. It does not parse course data, write files, poll for seat changes, or send notifications.

## Public Interface

The fetch module exposes an asynchronous function with a small typed contract:

```ts
type FetchDepartmentPageInput = {
  semester: string;
  department: string;
};

type FetchDepartmentPageResult = {
  html: string;
  finalUrl: string;
  status: number;
  fetchedAt: string;
};

function fetchDepartmentPage(
  input: FetchDepartmentPageInput,
): Promise<FetchDepartmentPageResult>;
```

The implementation builds the Testudo URL internally rather than accepting an arbitrary URL. This prevents accidental requests to unrelated hosts and centralizes knowledge of the upstream URL format.

## Input Rules

- `semester` must contain exactly six decimal digits in UMD's `YYYYMM` format.
- `department` must contain exactly four ASCII letters. It is normalized to uppercase.
- Invalid input fails before any network request.

These structural checks do not claim that a semester or department exists; Testudo remains authoritative for that.

## HTTP Behavior

- Use the HTTP client included with the supported Node.js runtime, avoiding an extra runtime dependency.
- Request HTML from the public Testudo Schedule of Classes endpoint for the supplied semester and department.
- Send an `Accept` header for HTML and an identifiable project `User-Agent` that does not impersonate a browser.
- Follow ordinary redirects and report the final response URL.
- Apply a finite request timeout so a stalled upstream cannot hang the ingestion job.
- Retry only transient responses: HTTP `429` and `5xx`, plus transient network failures.
- Use bounded exponential backoff and honor a valid `Retry-After` header when present.
- Limit the total number of attempts. No retry loop may run indefinitely.

The defaults will be conservative but injectable through module-level options for deterministic tests and future tuning. A single invocation fetches only one department page; later orchestration will be responsible for rate limiting between departments.

## Response Validation

A successful fetch must satisfy all of the following:

- The final HTTP status is in the `2xx` range.
- The `Content-Type` is HTML.
- The decoded body is not blank.
- The response does not appear to be an authentication page.

The fetch layer deliberately does not assert that particular course selectors exist. Markup-aware checks belong to the parser, where they can evolve without coupling parsing rules to networking.

## Errors

The module returns successful data or throws a typed fetch error containing a stable error code and a safe human-readable message. Expected codes cover:

- invalid input;
- timeout or network failure after retries;
- non-retryable HTTP status;
- retries exhausted;
- unexpected content type;
- empty response;
- suspected authentication page.

Errors may include status and URL metadata, but never include the full response body. This keeps logs useful without dumping a large or unexpected page.

## Testing

Unit tests inject a fake `fetch` implementation and a no-wait sleep function. They cover:

- a valid HTML response;
- input normalization and rejection;
- redirect metadata;
- timeout and network errors;
- retry of `429` and `5xx` responses;
- no retry for permanent `4xx` responses;
- retry exhaustion;
- non-HTML, blank, and apparent login responses;
- `Retry-After` and bounded backoff behavior.

Normal automated tests make no external requests. An opt-in integration test or script will perform one real CMSC `202608` request to verify the current Testudo endpoint and response assumptions. It will not run as part of the default test command.

## Project Structure

The initial project will use a minimal TypeScript layout:

```text
src/
  testudo/
    fetch-department-page.ts
    fetch-department-page.test.ts
```

Project configuration will include package scripts for type checking and unit tests. Parser, output, and web application modules are intentionally deferred.

## Acceptance Criteria

- The function retrieves the official Testudo HTML for `202608` and `CMSC` in an opt-in live check.
- Unit tests verify the success, validation, retry, timeout, and response-rejection paths without network access.
- Type checking and default tests pass.
- No parser, persistence, seat-history, notification, or website behavior is introduced in this milestone.
