import type { CourseListItem } from "../src/db/list-courses";
import { ScheduleWorkspace } from "./schedule-workspace";
import { searchCourseCatalog } from "./search-course-catalog";

type SearchParams = Promise<{
  query?: string | string[];
}>;

type Search = (query: string) => Promise<CourseListItem[]>;

export interface CourseSearchPageProps {
  searchParams: SearchParams;
  search?: Search;
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
}: CourseSearchPageProps) {
  const queryParam = (await searchParams).query;
  const query = typeof queryParam === "string" ? queryParam.trim() : "";

  if (!query) {
    return <ScheduleWorkspace />;
  }

  try {
    const courses = await search(query);
    return (
      <ScheduleWorkspace
        courses={courses}
        query={query}
        status={resultStatus(courses.length)}
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
