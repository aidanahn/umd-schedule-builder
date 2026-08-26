import { describe, expect, it, vi } from "vitest";

import {
  buildDepartmentUrl,
  buildSectionsUrl,
  fetchDepartmentPage,
  fetchDepartmentSections,
  TestudoFetchError,
} from "./fetch-department-page.js";

describe("buildDepartmentUrl", () => {
  it("builds the Testudo URL and normalizes the department", () => {
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

describe("buildSectionsUrl", () => {
  it("builds Testudo's bulk sections URL with repeated course IDs", () => {
    expect(
      buildSectionsUrl({
        semester: "202608",
        courseIds: ["cmsc131", "CMSC132"],
      }),
    ).toBe(
      "https://app.testudo.umd.edu/soc/202608/sections?courseIds=CMSC131&courseIds=CMSC132",
    );
  });

  it("fetches all requested section rows in one request", async () => {
    const html = '<div class="course-sections" id="CMSC131"></div>';
    const response = new Response(html, {
      status: 200,
      headers: { "content-type": "text/html;charset=ISO-8859-1" },
    });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);

    await expect(
      fetchDepartmentSections(
        { semester: "202608", courseIds: ["CMSC131"] },
        { fetchImpl },
      ),
    ).resolves.toMatchObject({ html, status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("fetchDepartmentPage", () => {
  const input = { semester: "202608", department: "CMSC" };

  it("fetches HTML and returns response metadata", async () => {
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

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://app.testudo.umd.edu/soc/202608/CMSC",
      expect.objectContaining({
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "umd-schedule-builder/0.1",
        },
        redirect: "follow",
      }),
    );
  });

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
      new Response(
        "<html><title>Central Authentication Service</title></html>",
        {
          status: 200,
          headers: { "content-type": "text/html" },
        },
      ),
      "AUTH_PAGE",
    ],
  ])("rejects invalid successful content with %s", async (response, code) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);

    await expect(
      fetchDepartmentPage(input, { fetchImpl }),
    ).rejects.toMatchObject({ code });
  });

  it("rejects a permanent HTTP error without exposing its body", async () => {
    const responseBody = "upstream page body must not appear in errors";
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(responseBody, {
        status: 404,
        headers: { "content-type": "text/html" },
      }),
    );

    const error = await fetchDepartmentPage(input, { fetchImpl }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toMatchObject({
      code: "HTTP_ERROR",
      metadata: { status: 404 },
    });
    expect(String(error)).not.toContain(responseBody);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

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

  it("reports exhausted retries after the final transient response", async () => {
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

    await fetchDepartmentPage(input, {
      fetchImpl,
      sleep,
      maxDelayMs: 5_000,
    });

    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it("honors an HTTP-date Retry-After header", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("slow down", {
          status: 429,
          headers: { "retry-after": "Tue, 25 Aug 2026 22:30:03 GMT" },
        }),
      )
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
      now: () => new Date("2026-08-25T22:30:00.000Z"),
      maxDelayMs: 5_000,
    });

    expect(sleep).toHaveBeenCalledWith(3_000);
  });

  it("reports a network error after retrying", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("offline"));

    await expect(
      fetchDepartmentPage(input, {
        fetchImpl,
        sleep: async () => undefined,
        maxAttempts: 2,
      }),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("aborts a stalled request and reports a timeout", async () => {
    vi.useFakeTimers();

    try {
      const fetchImpl = vi.fn<typeof fetch>(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      );
      const promise = fetchDepartmentPage(input, {
        fetchImpl,
        sleep: async () => undefined,
        timeoutMs: 50,
        maxAttempts: 1,
      });
      const assertion = expect(promise).rejects.toMatchObject({
        code: "TIMEOUT",
      });

      await vi.advanceTimersByTimeAsync(50);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects non-positive retry options before requesting Testudo", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      fetchDepartmentPage(input, { fetchImpl, maxAttempts: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
