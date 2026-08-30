import { renderToStaticMarkup } from "react-dom/server";
import { load } from "cheerio";
import { describe, expect, test } from "vitest";

import Page from "./page";

describe("home page", () => {
  test("renders the course search shell", () => {
    const $ = load(renderToStaticMarkup(<Page />));

    expect($("main")).toHaveLength(1);
    expect($("h1").text()).toBe("UMD Course Search");
    expect($("input#course-query[type='search']")).toHaveLength(1);
  });
});
