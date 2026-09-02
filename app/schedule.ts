import type { CourseListItem } from "../src/db/list-courses.js";

export interface ScheduleMeeting {
  days: string[];
  displayTime: string | null;
  building: string | null;
  room: string | null;
  type: string | null;
}

export interface ScheduleSection {
  semester: string;
  courseId: string;
  courseTitle: string;
  sectionId: string;
  sectionNumber: string;
  instructors: string[];
  meetings: ScheduleMeeting[];
}

export function scheduleSectionKey(section: ScheduleSection): string {
  return JSON.stringify([
    section.semester,
    section.courseId,
    section.sectionId,
  ]);
}

export function createScheduleSection(
  semester: string,
  course: CourseListItem,
  section: CourseListItem["sections"][number],
): ScheduleSection {
  return {
    semester,
    courseId: course.id,
    courseTitle: course.title,
    sectionId: section.id,
    sectionNumber: section.number,
    instructors: [...section.instructors],
    meetings: section.meetings.map((meeting) => ({
      days: [...meeting.days],
      displayTime: meeting.displayTime,
      building: meeting.building,
      room: meeting.room,
      type: meeting.type,
    })),
  };
}

export function addScheduleSection(
  sections: readonly ScheduleSection[],
  section: ScheduleSection,
): ScheduleSection[] {
  const key = scheduleSectionKey(section);

  return sections.some((current) => scheduleSectionKey(current) === key)
    ? [...sections]
    : [...sections, section];
}

export function removeScheduleSection(
  sections: readonly ScheduleSection[],
  key: string,
): ScheduleSection[] {
  return sections.filter((section) => scheduleSectionKey(section) !== key);
}
