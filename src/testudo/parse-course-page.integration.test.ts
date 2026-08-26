import { describe, expect, it } from "vitest";

import { parseCoursePage } from "./parse-course-page.js";

const runLiveTests = process.env.RUN_LIVE_TESTS === "true";

describe.skipIf(!runLiveTests)("Testudo course parser integration", () => {
  it(
    "parses the Fall 2026 CMSC131 detail page",
    async () => {
      const response = await fetch(
        "https://app.testudo.umd.edu/soc/202608/CMSC/CMSC131",
        {
          headers: {
            accept: "text/html,application/xhtml+xml",
            "user-agent": "umd-schedule-builder/0.1",
          },
        },
      );
      expect(response.ok).toBe(true);

      const result = parseCoursePage({
        html: await response.text(),
        semester: "202608",
        sourceUrl: response.url,
      });

      expect(result.course.id).toBe("CMSC131");
      expect(result.course.sections.length).toBeGreaterThan(0);
      expect(result.course.sections[0]?.id).toMatch(/^CMSC131-[A-Z0-9]{4}$/);
      expect(result.course.sections[0]?.meetings.length).toBeGreaterThan(0);
    },
    20_000,
  );
});
