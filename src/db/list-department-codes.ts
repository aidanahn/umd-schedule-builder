import { and, asc, eq } from "drizzle-orm";

import type { AppDatabase } from "./connection.js";
import { courses } from "./schema.js";

export interface ListDepartmentCodesScope {
  semester: string;
}

export async function listDepartmentCodes(
  db: AppDatabase,
  scope: ListDepartmentCodesScope,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ code: courses.departmentCode })
    .from(courses)
    .where(
      and(
        eq(courses.semesterCode, scope.semester),
        eq(courses.isActive, true),
      ),
    )
    .orderBy(asc(courses.departmentCode));
  return rows.map(({ code }) => code);
}
