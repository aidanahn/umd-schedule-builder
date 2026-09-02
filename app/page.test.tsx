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

import Page from "./page";

describe("home page", () => {
  test("renders the course search shell", async () => {
    const page = await Page({ searchParams: Promise.resolve({}) });
    const $ = load(renderToStaticMarkup(page));

    expect($("main")).toHaveLength(1);
    expect($("h1").text()).toBe("UMD Course Search");
    expect($("input#course-query[type='search']")).toHaveLength(1);
  });
});
