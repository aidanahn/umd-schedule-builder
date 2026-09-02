import { renderToStaticMarkup } from "react-dom/server";
import { load } from "cheerio";
import { describe, expect, test } from "vitest";

import type { CourseListItem } from "../src/db/list-courses";
import { CourseSearch } from "./course-search";

const detailedCourse: CourseListItem = {
  id: "CMSC216",
  title: "Introduction to Computer Systems",
  credits: { min: 4, max: 4 },
  gradingMethods: ["Regular", "Pass-Fail"],
  genEdCodes: ["Natural Sciences Lab"],
  description: "Computer systems fundamentals.",
  requirements: [
    { label: "Prerequisite", text: "CMSC132." },
    { label: "Restriction", text: "Permission of the department." },
  ],
  sections: [
    {
      id: "CMSC216-0101",
      number: "0101",
      deliveryMode: "face-to-face",
      notes: ["Restricted to majors."],
      instructors: ["Ada Lovelace", "Grace Hopper"],
      meetings: [
        {
          days: ["M", "W"],
          startMinutes: 600,
          endMinutes: 675,
          displayTime: "10:00am - 11:15am",
          building: "IRB",
          room: "0324",
          type: "Lecture",
        },
        {
          days: ["F"],
          startMinutes: 720,
          endMinutes: 770,
          displayTime: "12:00pm - 12:50pm",
          building: null,
          room: null,
          type: "Discussion",
        },
      ],
      seats: { total: 30, open: 2, waitlist: null, holdFile: 5 },
    },
  ],
};

const sparseCourse: CourseListItem = {
  id: "CMSC389A",
  title: "Special Topics in Computer Science",
  credits: { min: 1, max: 3 },
  gradingMethods: [],
  genEdCodes: [],
  description: null,
  requirements: [],
  sections: [
    {
      id: "CMSC389A-0101",
      number: "0101",
      deliveryMode: "unknown",
      notes: [],
      instructors: [],
      meetings: [],
      seats: null,
    },
  ],
};

const courses = [detailedCourse, sparseCourse];

describe("CourseSearch", () => {
  test("renders a GET search form with the current query and status", () => {
    const $ = load(
      renderToStaticMarkup(
        <CourseSearch query="CMSC216" status="1 course found." />,
      ),
    );

    expect($.root().text()).not.toContain("UMD Schedule Builder");
    expect($("h1").text()).toBe("UMD Course Search");
    expect($("form").attr("action")).toBe("/");
    expect($("form").attr("method")).toBe("get");
    expect($("label[for='semester']").text()).toBe("Semester");
    expect($("select#semester").val()).toBe("202608");
    expect($("select#semester option:selected").text()).toBe("Fall 2026");
    expect($("select#semester").is("[disabled]")).toBe(true);
    expect($("label[for='department']").text()).toBe("Department");
    expect($("input#department").attr("value")).toBe("CMSC");
    expect($("input#department").is("[readonly]")).toBe(true);
    expect($("label[for='course-query']").text()).toBe("Course");
    expect($("input#course-query[type='search']")).toHaveLength(1);
    expect($("input#course-query").attr("value")).toBe("CMSC216");
    expect($("button[type='submit']").text()).toBe("Search");
    expect($("button[type='submit']").is("[disabled]")).toBe(false);
    expect($("[role='status']").text()).toBe("1 course found.");
  });

  test("renders returned courses with their catalog metadata", () => {
    const $ = load(
      renderToStaticMarkup(
        <CourseSearch
          courses={courses}
          query="CMSC"
          status="2 courses found."
        />,
      ),
    );

    const results = $("[aria-label='Course search results'] > article");
    expect(results).toHaveLength(2);
    expect(results.eq(0).find("h3").text()).toBe(
      "CMSC216 Introduction to Computer Systems",
    );
    expect(results.eq(0).text()).toContain("4 credits");
    expect(results.eq(0).text()).toContain("Regular, Pass-Fail");
    expect(results.eq(0).text()).toContain("Natural Sciences Lab");
    expect(results.eq(0).text()).toContain("Computer systems fundamentals.");
    expect(results.eq(1).find("h3").text()).toBe(
      "CMSC389A Special Topics in Computer Science",
    );
    expect(results.eq(1).text()).toContain("1–3 credits");
    expect(results.eq(1).text()).not.toContain("Description unavailable");
  });

  test("omits the results region when no courses are provided", () => {
    const $ = load(
      renderToStaticMarkup(
        <CourseSearch query="CMSC999" status="No courses found." />,
      ),
    );

    expect($("[aria-label='Course search results']")).toHaveLength(0);
  });

  test("renders requirements and current section details", () => {
    const $ = load(
      renderToStaticMarkup(
        <CourseSearch
          courses={courses}
          query="CMSC216"
          status="1 course found."
        />,
      ),
    );

    const course = $("[aria-label='Course search results'] article").first();
    expect(course.find("[aria-label='Course requirements'] li")).toHaveLength(2);
    expect(course.find("[aria-label='Course requirements']").text()).toContain(
      "Prerequisite: CMSC132.",
    );

    const section = course.find("[aria-label='CMSC216 sections'] article");
    expect(section.find("h4").text()).toBe("Section 0101");
    expect(section.text()).toContain("Face-to-face");
    expect(section.text()).toContain("Ada Lovelace, Grace Hopper");
    expect(section.text()).toContain("MW 10:00am - 11:15am");
    expect(section.text()).toContain("IRB 0324");
    expect(section.text()).toContain("Lecture");
    expect(section.text()).toContain("Open 2");
    expect(section.text()).toContain("Total 30");
    expect(section.text()).toContain("Waitlist Not listed");
    expect(section.text()).toContain("Holdfile 5");
    expect(section.text()).toContain("Restricted to majors.");
  });

  test("renders honest fallbacks for missing section data", () => {
    const $ = load(
      renderToStaticMarkup(
        <CourseSearch
          courses={[sparseCourse]}
          query="CMSC389A"
          status="1 course found."
        />,
      ),
    );

    const section = $("[aria-label='CMSC389A sections'] article");
    expect(section.text()).toContain("Delivery mode not listed");
    expect(section.text()).toContain("Instructor not listed");
    expect(section.text()).toContain("Meeting details not listed");
    expect(section.text()).toContain("Seat data unavailable");
  });

  test("distinguishes a course with no sections from a failed search", () => {
    const $ = load(
      renderToStaticMarkup(
        <CourseSearch
          courses={[{ ...detailedCourse, sections: [] }]}
          query="CMSC216"
          status="1 course found."
        />,
      ),
    );

    expect($("[aria-label='CMSC216 sections']").text()).toContain(
      "No sections listed.",
    );
    expect($("[role='status']").text()).toBe("1 course found.");
  });
});
