import { describe, expect, it } from "vitest";

import type { AppDatabase } from "./connection.js";
import { listCourses } from "./list-courses.js";

describe("listCourses limit validation", () => {
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid limit %s before querying",
    async (limit) => {
      const db = new Proxy(
        {},
        {
          get() {
            throw new Error("database should not be reached");
          },
        },
      ) as AppDatabase;

      await expect(
        listCourses(db, { semester: "202608", limit }),
      ).rejects.toThrow("limit must be a positive safe integer");
    },
  );
});
