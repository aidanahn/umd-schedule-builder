import { describe, expect, it, vi } from "vitest";

import {
  buildDepartmentUrl,
  fetchDepartmentPage,
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
});
