import { and, asc, eq } from "drizzle-orm";

import type { AppDatabase } from "./connection.js";
import { courses } from "./schema.js";

export interface ListCoursesScope {
  semester: string;
  department: string;
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
}

export async function listCourses(
  db: AppDatabase,
  scope: ListCoursesScope,
): Promise<CourseListItem[]> {
  const rows = await db
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
      ),
    )
    .orderBy(asc(courses.courseId));

  return rows.map(({ creditsMin, creditsMax, ...course }) => ({
    ...course,
    credits: {
      min: creditsMin,
      max: creditsMax,
    },
  }));
}
