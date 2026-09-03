import { describe, expect, it, vi } from "vitest";

import type { AppDatabase } from "../src/db/connection.js";
import type { ListCoursesScope } from "../src/db/list-courses.js";
import type { CourseListItem } from "../src/db/list-courses.js";
import {
  listCatalogDepartmentCodes,
  searchCourseCatalog,
} from "./search-course-catalog.js";

function course(index: number): CourseListItem {
  return {
    id: `CMSC${String(index).padStart(3, "0")}`,
    title: `Course ${index}`,
    credits: { min: 3, max: 3 },
    gradingMethods: [],
    genEdCodes: [],
    description: null,
    requirements: [],
    sections: [],
  };
}

describe("searchCourseCatalog", () => {
  it("searches globally and requests one row beyond the display cap", async () => {
    const database = {} as AppDatabase;
    let receivedScope: ListCoursesScope | undefined;
    const list = vi.fn(async (_db, scope) => {
      receivedScope = scope;
      return Array.from({ length: 51 }, (_, index) => course(index));
    });

    const result = await searchCourseCatalog("calculus", undefined, {
      getDatabase: () => database,
      list,
    });

    expect(receivedScope).toEqual({
      semester: "202608",
      department: undefined,
      query: "calculus",
      limit: 51,
    });
    expect(result.courses).toHaveLength(50);
    expect(result.truncated).toBe(true);
  });

  it("passes an optional department and reports an untruncated result", async () => {
    const database = {} as AppDatabase;
    const list = vi.fn(async () => [course(140)]);

    const result = await searchCourseCatalog("calculus", "MATH", {
      getDatabase: () => database,
      list,
    });

    expect(list).toHaveBeenCalledWith(database, {
      semester: "202608",
      department: "MATH",
      query: "calculus",
      limit: 51,
    });
    expect(result).toEqual({ courses: [course(140)], truncated: false });
  });

  it("loads active Fall 2026 department codes", async () => {
    const database = {} as AppDatabase;
    const listDepartments = vi.fn(async () => ["CMSC", "MATH"]);

    await expect(
      listCatalogDepartmentCodes({
        getDatabase: () => database,
        listDepartments,
      }),
    ).resolves.toEqual(["CMSC", "MATH"]);
    expect(listDepartments).toHaveBeenCalledWith(database, {
      semester: "202608",
    });
  });
});
