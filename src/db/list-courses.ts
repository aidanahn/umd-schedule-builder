import { and, asc, eq, ilike, inArray, or } from "drizzle-orm";

import type { AppDatabase } from "./connection.js";
import {
  courseRequirements,
  courses,
  departmentIngestionHeads,
  seatObservations,
  sectionInstructors,
  sectionMeetings,
  sections,
} from "./schema.js";

export interface ListCoursesScope {
  semester: string;
  department: string;
  query?: string;
}

export interface CourseListItem {
  id: string;
  title: string;
  credits: {
    min: number;
    max: number;
  };
  gradingMethods: string[];
  genEdCodes: string[];
  description: string | null;
  requirements: CourseRequirementListItem[];
  sections: CourseSectionListItem[];
}

export interface CourseRequirementListItem {
  label: string;
  text: string;
}

export interface CourseMeetingListItem {
  days: string[];
  startMinutes: number | null;
  endMinutes: number | null;
  displayTime: string | null;
  building: string | null;
  room: string | null;
  type: string | null;
}

export interface CourseSectionListItem {
  id: string;
  number: string;
  deliveryMode: "face-to-face" | "blended" | "online" | "unknown";
  notes: string[];
  instructors: string[];
  meetings: CourseMeetingListItem[];
  seats: {
    total: number;
    open: number;
    waitlist: number | null;
    holdFile: number | null;
  } | null;
}

export async function listCourses(
  db: AppDatabase,
  scope: ListCoursesScope,
): Promise<CourseListItem[]> {
  const query = scope.query?.trim();
  const searchPattern = query
    ? `%${query.replace(/[\\%_]/g, "\\$&")}%`
    : undefined;

  const courseRows = await db
    .select({
      id: courses.courseId,
      title: courses.title,
      creditsMin: courses.creditsMin,
      creditsMax: courses.creditsMax,
      gradingMethods: courses.gradingMethods,
      genEdCodes: courses.genEdCodes,
      description: courses.description,
    })
    .from(courses)
    .where(
      and(
        eq(courses.semesterCode, scope.semester),
        eq(courses.departmentCode, scope.department),
        eq(courses.isActive, true),
        searchPattern
          ? or(
              ilike(courses.courseId, searchPattern),
              ilike(courses.title, searchPattern),
            )
          : undefined,
      ),
    )
    .orderBy(asc(courses.courseId));

  if (courseRows.length === 0) {
    return [];
  }

  const courseIds = courseRows.map(({ id }) => id);
  const requirementRows = await db
    .select({
      courseId: courseRequirements.courseId,
      label: courseRequirements.label,
      text: courseRequirements.text,
    })
    .from(courseRequirements)
    .where(
      and(
        eq(courseRequirements.semesterCode, scope.semester),
        inArray(courseRequirements.courseId, courseIds),
      ),
    )
    .orderBy(
      asc(courseRequirements.courseId),
      asc(courseRequirements.position),
    );

  const sectionRows = await db
    .select({
      id: sections.sectionId,
      courseId: sections.courseId,
      number: sections.sectionNumber,
      deliveryMode: sections.deliveryMode,
      notes: sections.notes,
    })
    .from(sections)
    .where(
      and(
        eq(sections.semesterCode, scope.semester),
        inArray(sections.courseId, courseIds),
        eq(sections.isActive, true),
      ),
    )
    .orderBy(asc(sections.courseId), asc(sections.sectionNumber));

  const [head] = await db
    .select({ latestIngestionId: departmentIngestionHeads.latestIngestionId })
    .from(departmentIngestionHeads)
    .where(
      and(
        eq(departmentIngestionHeads.semesterCode, scope.semester),
        eq(departmentIngestionHeads.departmentCode, scope.department),
      ),
    )
    .limit(1);

  const sectionIds = sectionRows.map(({ id }) => id);
  const instructorRows = sectionIds.length
    ? await db
        .select({
          sectionId: sectionInstructors.sectionId,
          name: sectionInstructors.name,
        })
        .from(sectionInstructors)
        .where(
          and(
            eq(sectionInstructors.semesterCode, scope.semester),
            inArray(sectionInstructors.sectionId, sectionIds),
          ),
        )
        .orderBy(
          asc(sectionInstructors.sectionId),
          asc(sectionInstructors.position),
        )
    : [];

  const meetingRows = sectionIds.length
    ? await db
        .select({
          sectionId: sectionMeetings.sectionId,
          days: sectionMeetings.days,
          startMinutes: sectionMeetings.startMinutes,
          endMinutes: sectionMeetings.endMinutes,
          displayTime: sectionMeetings.displayTime,
          building: sectionMeetings.building,
          room: sectionMeetings.room,
          type: sectionMeetings.meetingType,
        })
        .from(sectionMeetings)
        .where(
          and(
            eq(sectionMeetings.semesterCode, scope.semester),
            inArray(sectionMeetings.sectionId, sectionIds),
          ),
        )
        .orderBy(
          asc(sectionMeetings.sectionId),
          asc(sectionMeetings.position),
        )
    : [];

  const observationRows =
    sectionIds.length && head?.latestIngestionId
      ? await db
          .select({
            sectionId: seatObservations.sectionId,
            total: seatObservations.totalSeats,
            open: seatObservations.openSeats,
            waitlist: seatObservations.waitlistCount,
            holdFile: seatObservations.holdFileCount,
          })
          .from(seatObservations)
          .where(
            and(
              eq(seatObservations.ingestionId, head.latestIngestionId),
              eq(seatObservations.semesterCode, scope.semester),
              inArray(seatObservations.sectionId, sectionIds),
            ),
          )
      : [];

  const requirementsByCourse = new Map<
    string,
    CourseRequirementListItem[]
  >();
  for (const { courseId, ...requirement } of requirementRows) {
    const requirements = requirementsByCourse.get(courseId) ?? [];
    requirements.push(requirement);
    requirementsByCourse.set(courseId, requirements);
  }

  const instructorsBySection = new Map<string, string[]>();
  for (const { sectionId, name } of instructorRows) {
    const instructors = instructorsBySection.get(sectionId) ?? [];
    instructors.push(name);
    instructorsBySection.set(sectionId, instructors);
  }

  const meetingsBySection = new Map<string, CourseMeetingListItem[]>();
  for (const { sectionId, ...meeting } of meetingRows) {
    const meetings = meetingsBySection.get(sectionId) ?? [];
    meetings.push(meeting);
    meetingsBySection.set(sectionId, meetings);
  }

  const observationsBySection = new Map(
    observationRows.map(({ sectionId, ...seats }) => [sectionId, seats]),
  );
  const sectionsByCourse = new Map<string, CourseSectionListItem[]>();
  for (const { courseId, ...section } of sectionRows) {
    const courseSections = sectionsByCourse.get(courseId) ?? [];
    courseSections.push({
      ...section,
      instructors: instructorsBySection.get(section.id) ?? [],
      meetings: meetingsBySection.get(section.id) ?? [],
      seats: observationsBySection.get(section.id) ?? null,
    });
    sectionsByCourse.set(courseId, courseSections);
  }

  return courseRows.map(({ creditsMin, creditsMax, ...course }) => ({
    ...course,
    credits: {
      min: creditsMin,
      max: creditsMax,
    },
    requirements: requirementsByCourse.get(course.id) ?? [],
    sections: sectionsByCourse.get(course.id) ?? [],
  }));
}
