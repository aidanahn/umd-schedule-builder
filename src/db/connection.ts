import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

import { schema } from "./schema.js";

export type AppDatabase = NodePgDatabase<typeof schema>;

export class DatabaseConfigurationError extends Error {
  readonly code = "DATABASE_URL_MISSING";

  constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigurationError";
  }
}

export function resolveDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const value = env.DATABASE_URL?.trim();

  if (!value) {
    throw new DatabaseConfigurationError("DATABASE_URL is required");
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
