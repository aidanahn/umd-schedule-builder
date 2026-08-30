import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

import { schema } from "./schema.js";

export type AppDatabase = NodePgDatabase<typeof schema>;

export type DatabaseConfigurationErrorCode =
  | "DATABASE_URL_MISSING"
  | "DATABASE_URL_INVALID";

export class DatabaseConfigurationError extends Error {
  constructor(
    message: string,
    public readonly code: DatabaseConfigurationErrorCode =
      "DATABASE_URL_MISSING",
  ) {
    super(message);
    this.name = "DatabaseConfigurationError";
  }
}

type DatabaseEnvironment = {
  DATABASE_URL?: string;
};

export function resolveDatabaseUrl(
  env?: DatabaseEnvironment,
): string {
  const value = (
    env === undefined ? process.env.DATABASE_URL : env.DATABASE_URL
  )?.trim();

  if (!value) {
    throw new DatabaseConfigurationError("DATABASE_URL is required");
  }

  try {
    const url = new URL(value);
    const databaseName = decodeURIComponent(
      url.pathname.split("/").filter(Boolean).at(-1) ?? "",
    );

    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !databaseName
    ) {
      throw new Error("invalid PostgreSQL URL");
    }
  } catch {
    throw new DatabaseConfigurationError(
      "DATABASE_URL must be a valid PostgreSQL URL",
      "DATABASE_URL_INVALID",
    );
  }

  return value;
}

type PoolFactory = (config: PoolConfig) => Pool;

export interface CreateDatabaseConnectionOptions {
  connectionString?: string;
  poolFactory?: PoolFactory;
}

export interface DatabaseConnection {
  db: AppDatabase;
  pool: Pool;
  close(): Promise<void>;
}

export function createDatabaseConnection(
  options: CreateDatabaseConnectionOptions = {},
): DatabaseConnection {
  const connectionString =
    options.connectionString?.trim() || resolveDatabaseUrl();
  const pool = (options.poolFactory ?? ((config) => new Pool(config)))({
    connectionString,
  });
  const db = drizzle({ client: pool, schema });
  let closePromise: Promise<void> | undefined;

  return {
    db,
    pool,
    close() {
      closePromise ??= pool.end();
      return closePromise;
    },
  };
}
