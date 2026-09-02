import type { ReactNode } from "react";

import type { CourseListItem } from "../src/db/list-courses";
import {
  createScheduleSection,
  scheduleSectionKey,
} from "./schedule";

export interface CourseSearchProps {
  courses?: CourseListItem[];
  onAddSection?: (
    course: CourseListItem,
    section: CourseListItem["sections"][number],
  ) => void;
  onQueryChange?: (query: string) => void;
  query?: string;
  scheduleInitialized?: boolean;
  schedulePanel?: ReactNode;
  scheduleSemester?: string;
  selectedSectionKeys?: ReadonlySet<string>;
  status?: string;
}

function formatCredits({ min, max }: CourseListItem["credits"]): string {
  return min === max ? `${min} credits` : `${min}–${max} credits`;
}

function formatDeliveryMode(
  mode: CourseListItem["sections"][number]["deliveryMode"],
): string {
  switch (mode) {
    case "face-to-face":
      return "Face-to-face";
    case "blended":
      return "Blended";
    case "online":
      return "Online";
    case "unknown":
      return "Delivery mode not listed";
  }
}

function formatNullableCount(value: number | null): string {
  return value === null ? "Not listed" : String(value);
}

export function CourseSearch({
  courses = [],
  onAddSection,
  onQueryChange,
  query = "",
  scheduleInitialized = false,
  schedulePanel,
  scheduleSemester = "202608",
  selectedSectionKeys,
  status = "Enter a course ID or title to search.",
}: CourseSearchProps = {}) {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12 text-slate-950 sm:px-6">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">
            UMD Course Search
          </h1>
          <p className="mt-3 max-w-2xl text-slate-600">
            Search the course catalog before adding classes to your schedule.
          </p>
        </header>

        <section
          aria-labelledby="course-search-heading"
          className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
        >
          <h2 id="course-search-heading" className="text-lg font-medium">
            Search courses
          </h2>

          <form action="/" method="get">
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium" htmlFor="semester">
                  Semester
                </label>
                <select
                  className="mt-2 w-full rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-700"
                  defaultValue="202608"
                  disabled
                  id="semester"
                >
                  <option value="202608">Fall 2026</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium" htmlFor="department">
                  Department
                </label>
                <input
                  className="mt-2 w-full rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-700"
                  id="department"
                  readOnly
                  value="CMSC"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-sm font-medium" htmlFor="course-query">
                  Course
                </label>
                <input
                  className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100"
                  defaultValue={query}
                  id="course-query"
                  name="query"
                  onChange={(event) =>
                    onQueryChange?.(event.currentTarget.value)
                  }
                  placeholder="Try CMSC131 or Object-Oriented Programming"
                  type="search"
                />
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                className="rounded-md bg-slate-900 px-4 py-2 font-medium text-white"
                type="submit"
              >
                Search
              </button>
              <p className="text-sm text-slate-500" role="status">
                {status}
              </p>
            </div>
          </form>
        </section>

        {schedulePanel}

        {courses.length > 0 ? (
          <section
            aria-label="Course search results"
            className="mt-6 space-y-4"
          >
            {courses.map((course) => (
              <article
                className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
                key={course.id}
              >
                <h3 className="text-lg font-semibold">
                  {course.id} {course.title}
                </h3>
                <p className="mt-2 text-sm text-slate-600">
                  {formatCredits(course.credits)}
                </p>

                {course.description ? (
                  <p className="mt-4 text-slate-700">{course.description}</p>
                ) : null}

                {course.gradingMethods.length > 0 ? (
                  <p className="mt-4 text-sm text-slate-600">
                    <span className="font-medium text-slate-800">Grading:</span>{" "}
                    {course.gradingMethods.join(", ")}
                  </p>
                ) : null}

                {course.genEdCodes.length > 0 ? (
                  <p className="mt-1 text-sm text-slate-600">
                    <span className="font-medium text-slate-800">GenEd:</span>{" "}
                    {course.genEdCodes.join(", ")}
                  </p>
                ) : null}

                {course.requirements.length > 0 ? (
                  <div className="mt-4">
                    <p className="text-sm font-medium text-slate-800">
                      Requirements
                    </p>
                    <ul
                      aria-label="Course requirements"
                      className="mt-2 space-y-1 text-sm text-slate-600"
                    >
                      {course.requirements.map((requirement, index) => (
                        <li key={`${requirement.label}-${index}`}>
                          <span className="font-medium text-slate-800">
                            {requirement.label}:
                          </span>{" "}
                          {requirement.text}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <section
                  aria-label={`${course.id} sections`}
                  className="mt-5 border-t border-slate-200 pt-4"
                >
                  <p className="text-sm font-medium text-slate-800">Sections</p>

                  {course.sections.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-500">
                      No sections listed.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {course.sections.map((section) => {
                        const scheduleKey = scheduleSectionKey(
                          createScheduleSection(
                            scheduleSemester,
                            course,
                            section,
                          ),
                        );
                        const selected =
                          selectedSectionKeys?.has(scheduleKey) ?? false;

                        return (
                          <article
                            className="rounded-md border border-slate-200 bg-slate-50 p-4"
                            key={section.id}
                          >
                            <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                              <h4 className="font-medium">
                                Section {section.number}
                              </h4>
                              <p className="text-sm text-slate-500">
                                {formatDeliveryMode(section.deliveryMode)}
                              </p>
                            </div>

                            {onAddSection ? (
                              <button
                                className="mt-3 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:cursor-default disabled:bg-slate-300"
                                disabled={!scheduleInitialized || selected}
                                onClick={() => onAddSection(course, section)}
                                type="button"
                              >
                                {selected
                                  ? "Added"
                                  : scheduleInitialized
                                    ? "Add to schedule"
                                    : "Loading schedule"}
                              </button>
                            ) : null}

                            <p className="mt-3 text-sm text-slate-700">
                              <span className="font-medium">Instructor:</span>{" "}
                              {section.instructors.length > 0
                                ? section.instructors.join(", ")
                                : "Instructor not listed"}
                            </p>

                            {section.meetings.length > 0 ? (
                              <ul className="mt-3 space-y-2 text-sm text-slate-600">
                                {section.meetings.map((meeting, index) => {
                                  const location = [
                                    meeting.building,
                                    meeting.room,
                                  ]
                                    .filter(Boolean)
                                    .join(" ");

                                  return (
                                    <li key={index}>
                                      <p>
                                        {meeting.days.join("") ||
                                          "Days not listed"}{" "}
                                        {meeting.displayTime ?? "Time not listed"}
                                      </p>
                                      {location ? <p>{location}</p> : null}
                                      {meeting.type ? <p>{meeting.type}</p> : null}
                                    </li>
                                  );
                                })}
                              </ul>
                            ) : (
                              <p className="mt-3 text-sm text-slate-500">
                                Meeting details not listed
                              </p>
                            )}

                            {section.seats ? (
                              <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-slate-700 sm:grid-cols-4">
                                <p>
                                  <span className="font-medium">Open</span>{" "}
                                  {section.seats.open}
                                </p>
                                <p>
                                  <span className="font-medium">Total</span>{" "}
                                  {section.seats.total}
                                </p>
                                <p>
                                  <span className="font-medium">Waitlist</span>{" "}
                                  {formatNullableCount(section.seats.waitlist)}
                                </p>
                                <p>
                                  <span className="font-medium">Holdfile</span>{" "}
                                  {formatNullableCount(section.seats.holdFile)}
                                </p>
                              </div>
                            ) : (
                              <p className="mt-3 text-sm text-slate-500">
                                Seat data unavailable
                              </p>
                            )}

                            {section.notes.length > 0 ? (
                              <ul className="mt-3 space-y-1 text-sm text-slate-600">
                                {section.notes.map((note, index) => (
                                  <li key={index}>{note}</li>
                                ))}
                              </ul>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  )}
                </section>
              </article>
            ))}
          </section>
        ) : null}
      </div>
    </main>
  );
}
