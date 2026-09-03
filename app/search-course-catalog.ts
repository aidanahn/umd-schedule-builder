import {
  createDatabaseConnection,
  type AppDatabase,
  type DatabaseConnection,
} from "../src/db/connection";
import {
  listCourses,
  type CourseListItem,
} from "../src/db/list-courses";
import { listDepartmentCodes } from "../src/db/list-department-codes";

type ApplicationDatabaseGlobal = typeof globalThis & {
  umdScheduleBuilderDatabaseConnection?: DatabaseConnection;
};

const applicationDatabaseGlobal = globalThis as ApplicationDatabaseGlobal;

function getApplicationDatabase(): AppDatabase {
  applicationDatabaseGlobal.umdScheduleBuilderDatabaseConnection ??=
    createDatabaseConnection();
  return applicationDatabaseGlobal.umdScheduleBuilderDatabaseConnection.db;
}

export interface SearchCourseCatalogDependencies {
  getDatabase?: () => AppDatabase;
  list?: typeof listCourses;
  listDepartments?: typeof listDepartmentCodes;
}

export interface CatalogSearchResult {
  courses: CourseListItem[];
  truncated: boolean;
}

export async function searchCourseCatalog(
  query: string,
  department: string | undefined,
  dependencies: SearchCourseCatalogDependencies = {},
): Promise<CatalogSearchResult> {
  const database = (dependencies.getDatabase ?? getApplicationDatabase)();
  const matches = await (dependencies.list ?? listCourses)(database, {
    semester: "202608",
    department,
    query,
    limit: 51,
  });
  return {
    courses: matches.slice(0, 50),
    truncated: matches.length > 50,
  };
}

export function listCatalogDepartmentCodes(
  dependencies: SearchCourseCatalogDependencies = {},
): Promise<string[]> {
  const database = (dependencies.getDatabase ?? getApplicationDatabase)();
  return (dependencies.listDepartments ?? listDepartmentCodes)(database, {
    semester: "202608",
  });
}
