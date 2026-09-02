import {
  createDatabaseConnection,
  type AppDatabase,
  type DatabaseConnection,
} from "../src/db/connection";
import {
  listCourses,
  type CourseListItem,
} from "../src/db/list-courses";

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
}

export function searchCourseCatalog(
  query: string,
  dependencies: SearchCourseCatalogDependencies = {},
): Promise<CourseListItem[]> {
  const database = (dependencies.getDatabase ?? getApplicationDatabase)();

  return (dependencies.list ?? listCourses)(database, {
    semester: "202608",
    department: "CMSC",
    query,
  });
}
