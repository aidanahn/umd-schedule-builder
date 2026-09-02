import { describe, expect, test } from "vitest";

import type { AppDatabase } from "../src/db/connection.js";
import type { ListCoursesScope } from "../src/db/list-courses.js";
import { searchCourseCatalog } from "./search-course-catalog.js";

describe("searchCourseCatalog", () => {
  test("searches the Fall 2026 CMSC catalog", async () => {
    const database = {} as AppDatabase;
    let receivedDatabase: AppDatabase | undefined;
    let receivedScope: ListCoursesScope | undefined;

    await searchCourseCatalog("CMSC216", {
      getDatabase: () => database,
      list: async (db, scope) => {
        receivedDatabase = db;
        receivedScope = scope;
        return [];
      },
    });

    expect(receivedDatabase).toBe(database);
    expect(receivedScope).toEqual({
      semester: "202608",
      department: "CMSC",
      query: "CMSC216",
    });
  });
});
