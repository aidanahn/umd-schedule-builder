import { describe, expect, it } from "vitest";

import { fetchDepartmentPage } from "./fetch-department-page.js";

const runLiveTests = process.env.RUN_LIVE_TESTS === "true";

describe.skipIf(!runLiveTests)("Testudo integration", () => {
  it(
    "fetches the Fall 2026 CMSC schedule",
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
