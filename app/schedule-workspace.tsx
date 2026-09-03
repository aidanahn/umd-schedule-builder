"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { CourseListItem } from "../src/db/list-courses.js";
import { buildCatalogSearchUrl } from "./catalog-search-url";
import { CourseSearch } from "./course-search";
import {
  clearStoredSchedule,
  loadSchedule,
  saveSchedule,
} from "./schedule-storage";
import {
  addScheduleSection,
  createScheduleSection,
  removeScheduleSection,
  scheduleSectionKey,
  type ScheduleSection,
} from "./schedule";

export interface ScheduleWorkspaceProps {
  courses?: CourseListItem[];
  department?: string | undefined;
  departmentCodes?: string[];
  query?: string;
  semester?: string;
  status?: string;
}

function MeetingList({ meetings }: Pick<ScheduleSection, "meetings">) {
  if (meetings.length === 0) {
    return (
      <p className="mt-2 text-sm text-slate-500">
        Meeting details not listed
      </p>
    );
  }

  return (
    <ul className="mt-2 space-y-2 text-sm text-slate-600">
      {meetings.map((meeting, index) => {
        const location = [meeting.building, meeting.room]
          .filter(Boolean)
          .join(" ");

        return (
          <li key={index}>
            <p>
              {meeting.days.join("") || "Days not listed"}{" "}
              {meeting.displayTime ?? "Time not listed"}
            </p>
            {location ? <p>{location}</p> : null}
            {meeting.type ? <p>{meeting.type}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}

export function ScheduleWorkspace({
  courses = [],
  department,
  departmentCodes = [],
  query = "",
  semester = "202608",
  status = "Enter a course ID or title to search.",
}: ScheduleWorkspaceProps = {}) {
  const router = useRouter();
  const [sections, setSections] = useState<ScheduleSection[]>([]);
  const [initialized, setInitialized] = useState(false);
  const skipInitialPersistence = useRef(true);
  const currentQueryRef = useRef(query);

  useEffect(() => {
    currentQueryRef.current = query;
  }, [query]);

  useEffect(() => {
    setSections(loadSchedule(window.localStorage));
    setInitialized(true);
  }, []);

  useEffect(() => {
    if (!initialized) {
      return;
    }

    if (skipInitialPersistence.current) {
      skipInitialPersistence.current = false;
      return;
    }

    if (sections.length === 0) {
      clearStoredSchedule(window.localStorage);
    } else {
      saveSchedule(window.localStorage, sections);
    }
  }, [initialized, sections]);

  const selectedSectionKeys = useMemo(
    () => new Set(sections.map(scheduleSectionKey)),
    [sections],
  );

  function addSection(
    course: CourseListItem,
    section: CourseListItem["sections"][number],
  ) {
    if (!initialized) {
      return;
    }

    setSections((current) =>
      addScheduleSection(
        current,
        createScheduleSection(semester, course, section),
      ),
    );
  }

  function updateQuery(nextQuery: string) {
    currentQueryRef.current = nextQuery;
    router.replace(buildCatalogSearchUrl({ query: nextQuery, department }), {
      scroll: false,
    });
  }

  function updateDepartment(nextDepartment: string | undefined) {
    router.replace(
      buildCatalogSearchUrl({
        query: currentQueryRef.current,
        department: nextDepartment,
      }),
      { scroll: false },
    );
  }

  const schedulePanel = (
    <section
      aria-labelledby="schedule-heading"
      className="mt-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 id="schedule-heading" className="text-lg font-medium">
          Your schedule
        </h2>
        {sections.length > 0 ? (
          <button
            className="text-sm font-medium text-slate-600 underline underline-offset-4"
            onClick={() => setSections([])}
            type="button"
          >
            Clear schedule
          </button>
        ) : null}
      </div>

      {!initialized ? (
        <p className="mt-3 text-sm text-slate-500">Loading schedule...</p>
      ) : sections.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No sections added yet.</p>
      ) : (
        <ul aria-label="Selected sections" className="mt-4 space-y-3">
          {sections.map((section) => {
            const key = scheduleSectionKey(section);

            return (
              <li
                aria-label={`${section.courseId} section ${section.sectionNumber}`}
                className="rounded-md border border-slate-200 bg-slate-50 p-4"
                key={key}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="font-medium">
                      {section.courseId} {section.courseTitle}
                    </h3>
                    <p className="mt-1 text-sm text-slate-600">
                      Section {section.sectionNumber}
                    </p>
                  </div>
                  <button
                    aria-label={`Remove ${section.courseId} section ${section.sectionNumber}`}
                    className="self-start text-sm font-medium text-slate-600 underline underline-offset-4"
                    onClick={() =>
                      setSections((current) =>
                        removeScheduleSection(current, key),
                      )
                    }
                    type="button"
                  >
                    Remove
                  </button>
                </div>

                <p className="mt-3 text-sm text-slate-700">
                  <span className="font-medium">Instructor:</span>{" "}
                  {section.instructors.length > 0
                    ? section.instructors.join(", ")
                    : "Instructor not listed"}
                </p>
                <MeetingList meetings={section.meetings} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  return (
    <CourseSearch
      courses={courses}
      department={department}
      departmentCodes={departmentCodes}
      onAddSection={addSection}
      onQueryChange={updateQuery}
      onDepartmentChange={updateDepartment}
      query={query}
      scheduleInitialized={initialized}
      schedulePanel={schedulePanel}
      scheduleSemester={semester}
      selectedSectionKeys={selectedSectionKeys}
      status={status}
    />
  );
}
