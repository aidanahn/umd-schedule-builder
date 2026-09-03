import { ScheduleWorkspace } from "./schedule-workspace";
import {
  listCatalogDepartmentCodes,
  searchCourseCatalog,
  type CatalogSearchResult,
} from "./search-course-catalog";

type SearchParams = Promise<{
  query?: string | string[];
  department?: string | string[];
}>;

type Search = (
  query: string,
  department: string | undefined,
) => Promise<CatalogSearchResult>;

export interface CourseSearchPageProps {
  searchParams: SearchParams;
  search?: Search;
  listDepartments?: () => Promise<string[]>;
}

function resultStatus(count: number): string {
  if (count === 0) {
    return "No courses found.";
  }

  return count === 1 ? "1 course found." : `${count} courses found.`;
}

export async function CourseSearchPage({
  searchParams,
  search = searchCourseCatalog,
  listDepartments = listCatalogDepartmentCodes,
}: CourseSearchPageProps) {
  const params = await searchParams;
  const queryParam = params.query;
  const query = typeof queryParam === "string" ? queryParam.trim() : "";

  try {
    const departmentCodes = await listDepartments();
    const requestedDepartment =
      typeof params.department === "string"
        ? params.department.trim().toUpperCase()
        : "";
    const department = departmentCodes.includes(requestedDepartment)
      ? requestedDepartment
      : undefined;

    if (!query) {
      return (
        <ScheduleWorkspace
          department={department}
          departmentCodes={departmentCodes}
        />
      );
    }

    const result = await search(query, department);
    return (
      <ScheduleWorkspace
        courses={result.courses}
        department={department}
        departmentCodes={departmentCodes}
        query={query}
        status={
          result.truncated
            ? "Showing the first 50 matching courses. Refine your search."
            : resultStatus(result.courses.length)
        }
      />
    );
  } catch {
    return (
      <ScheduleWorkspace
        query={query}
        status="Course search is temporarily unavailable."
      />
    );
  }
}
