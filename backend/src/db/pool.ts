import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { config } from "../config.js";

const pool = config.databaseEnabled
  ? new Pool({
      connectionString: config.databaseUrl,
    })
  : null;

function persistenceDisabledError(operation: string): Error {
  return new Error(`DATABASE_URL is not configured. Database-backed ${operation} is unavailable.`);
}

async function query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>> {
  if (!pool) {
    throw persistenceDisabledError("queries");
  }
  return pool.query<T>(text, values);
}

async function connect(): Promise<PoolClient> {
  if (!pool) {
    throw persistenceDisabledError("connections");
  }
  return pool.connect();
}

export const db = {
  query,
  connect,
};

export function isDatabaseEnabled(): boolean {
  return Boolean(pool);
}
