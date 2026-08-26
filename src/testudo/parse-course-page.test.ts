import { describe, expect, it } from "vitest";

import {
  parseCoursePage,
  TestudoParseError,
} from "./parse-course-page.js";

const courseHtml = `
  <div class="course" id="CMSC298A">
    <div class="course-id"> CMSC298A </div>
    <span class="course-title">Special &amp; Selected Topics</span>
    <span class="course-min-credits">1</span>
    <span class="course-max-credits">4</span>
    <span class="grading-method">
      <abbr title="Regular">Reg</abbr>
      <abbr title="Pass-Fail">P-F</abbr>
      <abbr title="Regular">Reg</abbr>
    </span>
    <div class="gen-ed-codes-group">
      <span class="course-subcategory"><a>DSSP</a></span>
      <span class="course-subcategory"><a>SCIS</a></span>
    </div>
    <div class="approved-course-texts-container">
      <div class="approved-course-text">
        <div><strong>Prerequisite:</strong> CMSC216.</div>
        <div><strong>Restriction:</strong> Permission of department.</div>
      </div>
      <div class="approved-course-text">
        First paragraph &amp; details.
      </div>
      <div class="approved-course-text">Second paragraph.</div>
    </div>
  </div>
`;

describe("parseCoursePage", () => {
  it("parses normalized course metadata", () => {
    const result = parseCoursePage({
      html: courseHtml,
      semester: "202608",
      sourceUrl: "https://app.testudo.umd.edu/soc/202608/CMSC/CMSC298A",
    });

    expect(result).toEqual({
      semester: "202608",
      course: {
        id: "CMSC298A",
        department: "CMSC",
        title: "Special & Selected Topics",
        credits: { min: 1, max: 4 },
        gradingMethods: ["Regular", "Pass-Fail"],
        genEdCodes: ["DSSP", "SCIS"],
        description: "First paragraph & details.\n\nSecond paragraph.",
        requirements: [
          { label: "Prerequisite", text: "CMSC216." },
          { label: "Restriction", text: "Permission of department." },
        ],
        sections: [],
      },
      warnings: [],
    });
  });

  it("uses the minimum credit value when no maximum is displayed", () => {
    const html = courseHtml.replace(
      '<span class="course-max-credits">4</span>',
      "",
    );

    expect(
      parseCoursePage({ html, semester: "202608" }).course.credits,
    ).toEqual({ min: 1, max: 1 });
  });

  it.each([
    [{ html: "", semester: "202608" }, "INVALID_INPUT"],
    [{ html: courseHtml, semester: "fall-2026" }, "INVALID_INPUT"],
    [
      { html: courseHtml.replace(/CMSC298A/g, ""), semester: "202608" },
      "COURSE_ID_MISSING",
    ],
    [
      {
        html: courseHtml.replace("Special &amp; Selected Topics", ""),
        semester: "202608",
      },
      "COURSE_TITLE_MISSING",
    ],
    [
      {
        html: courseHtml.replace(
          '<span class="course-min-credits">1</span>',
          '<span class="course-min-credits">many</span>',
        ),
        semester: "202608",
      },
      "CREDITS_INVALID",
    ],
    [
      { html: "<html>maintenance</html>", semester: "202608" },
      "PAGE_NOT_RECOGNIZED",
    ],
  ])("throws a typed course-level error %#", (input, code) => {
    let thrown: unknown;

    try {
      parseCoursePage(input);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TestudoParseError);
    expect(thrown).toMatchObject({ code });
  });
});
