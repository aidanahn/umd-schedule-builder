import { describe, expect, it, vi } from "vitest";

import { parseScrapeArgs, runScrape } from "./scrape.js";

describe("parseScrapeArgs", () => {
  it("normalizes valid arguments", () => {
    expect(
      parseScrapeArgs(["--semester", "202608", "--department", "cmsc"]),
    ).toEqual({ semester: "202608", department: "CMSC" });
  });

  it.each([
    [[], "--semester is required"],
    [["--semester", "202608"], "--department is required"],
    [
      ["--semester", "fall", "--department", "CMSC"],
      "semester must contain exactly six digits",
    ],
    [
      ["--semester", "202608", "--department", "CS"],
      "department must contain exactly four ASCII letters",
    ],
  ])("rejects invalid arguments %#", (argv, message) => {
    expect(() => parseScrapeArgs(argv)).toThrow(message);
  });
});

describe("runScrape", () => {
  it("prints the path and summary for a complete snapshot", async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const ingest = vi.fn().mockResolvedValue({
      path: "data/snapshots/202608/CMSC/result.json",
      snapshot: {
        status: "complete",
        summary: { coursesParsed: 2, sectionsParsed: 3 },
      },
    });

    await expect(
      runScrape(["--semester", "202608", "--department", "CMSC"], {
        ingest,
        stdout,
        stderr,
      }),
    ).resolves.toBe(0);
    expect(stdout).toHaveBeenCalledWith(
      "Wrote data/snapshots/202608/CMSC/result.json (2 courses, 3 sections)",
    );
    expect(stderr).not.toHaveBeenCalled();
  });

  it("reports a partial snapshot and returns one", async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const ingest = vi.fn().mockResolvedValue({
      path: "data/snapshots/202608/CMSC/partial.json",
      snapshot: {
        status: "partial",
        summary: {
          coursesParsed: 1,
          coursesFailed: 1,
          sectionsParsed: 2,
        },
      },
    });

    await expect(
      runScrape(["--semester", "202608", "--department", "CMSC"], {
        ingest,
        stdout,
        stderr,
      }),
    ).resolves.toBe(1);
    expect(stdout).toHaveBeenCalledWith(
      "Wrote data/snapshots/202608/CMSC/partial.json (1 course, 2 sections)",
    );
    expect(stderr).toHaveBeenCalledWith("Snapshot is partial: 1 course failed");
  });

  it("returns two for invalid arguments without ingesting", async () => {
    const ingest = vi.fn();
    const stderr = vi.fn();

    await expect(runScrape([], { ingest, stderr })).resolves.toBe(2);
    expect(ingest).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith("--semester is required");
  });

  it("returns one when ingestion fails", async () => {
    const stderr = vi.fn();
    const ingest = vi.fn().mockRejectedValue(new Error("Testudo unavailable"));

    await expect(
      runScrape(["--semester", "202608", "--department", "CMSC"], {
        ingest,
        stderr,
      }),
    ).resolves.toBe(1);
    expect(stderr).toHaveBeenCalledWith("Testudo unavailable");
  });
});
