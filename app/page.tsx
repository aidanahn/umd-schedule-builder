import { CourseSearchPage } from "./course-search-page";

export interface HomePageProps {
  searchParams: Promise<{
    query?: string | string[];
  }>;
}

export default async function Page({
  searchParams,
}: HomePageProps) {
  return CourseSearchPage({ searchParams });
}
