import { renderToStaticMarkup } from "react-dom/server";
import { load } from "cheerio";
import { describe, expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
    push: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
  }),
}));

import type { CourseListItem } from "../src/db/list-courses.js";
import { CourseSearchPage } from "./course-search-page.js";

const sampleCourse: CourseListItem = {
  id: "CMSC216",
  title: "Introduction to Computer Systems",
  credits: { min: 4, max: 4 },
  gradingMethods: ["Regular"],
  genEdCodes: [],
  description: "Computer systems fundamentals.",
  requirements: [],
  sections: [],
};

describe("CourseSearchPage", () => {
  test("forwards a trimmed query and renders the result count", async () => {
    let receivedQuery: string | undefined;
    const page = await CourseSearchPage({
      searchParams: Promise.resolve({ query: "  CMSC216  " }),
      search: async (query) => {
        receivedQuery = query;
        return [sampleCourse];
      },
    });
    const $ = load(renderToStaticMarkup(page));

    expect(receivedQuery).toBe("CMSC216");
    expect($("input#course-query").attr("value")).toBe("CMSC216");
    expect($("[role='status']").text()).toBe("1 course found.");
    expect($("[aria-label='Course search results'] article h3").text()).toBe(
      "CMSC216 Introduction to Computer Systems",
    );
  });

  test("does not search for a blank query", async () => {
    const page = await CourseSearchPage({
      searchParams: Promise.resolve({ query: "   " }),
      search: async () => {
        throw new Error("blank queries must not reach the database");
      },
    });
    const $ = load(renderToStaticMarkup(page));

    expect($("input#course-query").attr("value")).toBe("");
    expect($("[role='status']").text()).toBe(
      "Enter a course ID or title to search.",
    );
  });

  test("renders an empty result state", async () => {
    const page = await CourseSearchPage({
      searchParams: Promise.resolve({ query: "CMSC999" }),
      search: async () => [],
    });
    const $ = load(renderToStaticMarkup(page));

    expect($("[role='status']").text()).toBe("No courses found.");
    expect($("[aria-label='Course search results']")).toHaveLength(0);
  });

  test("renders a safe database error state", async () => {
    const page = await CourseSearchPage({
      searchParams: Promise.resolve({ query: "CMSC216" }),
      search: async () => {
        throw new Error("password=do-not-expose");
      },
    });
    const $ = load(renderToStaticMarkup(page));

    expect($("[role='status']").text()).toBe(
      "Course search is temporarily unavailable.",
    );
    expect($.root().text()).not.toContain("do-not-expose");
    expect($("[aria-label='Course search results']")).toHaveLength(0);
  });
});
