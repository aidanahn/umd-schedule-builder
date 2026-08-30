import { renderToStaticMarkup } from "react-dom/server";
import { load } from "cheerio";
import { describe, expect, test } from "vitest";

import { CourseSearch } from "./course-search";

describe("CourseSearch", () => {
  test("renders fixed catalog context and a disabled search action", () => {
    const $ = load(renderToStaticMarkup(<CourseSearch />));

    expect($("h1").text()).toBe("UMD Course Search");
    expect($("label[for='semester']").text()).toBe("Semester");
    expect($("select#semester").val()).toBe("202608");
    expect($("select#semester").is("[disabled]")).toBe(true);
    expect($("label[for='department']").text()).toBe("Department");
    expect($("input#department").attr("value")).toBe("CMSC");
    expect($("input#department").is("[readonly]")).toBe(true);
    expect($("label[for='course-query']").text()).toBe("Course");
    expect($("input#course-query[type='search']")).toHaveLength(1);
    expect($("button[type='button']").text()).toBe("Search");
    expect($("button[type='button']").is("[disabled]")).toBe(true);
    expect($("[role='status']").text()).toBe(
      "Catalog search will be connected next.",
    );
  });
});
