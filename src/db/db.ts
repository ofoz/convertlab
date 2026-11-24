import pg from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { Pool } = pg;

export type DbRow = Record<string, unknown>;

export type Queryable = {
  query<T extends DbRow = DbRow>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
};

export type Db = {
  readonly pool: pg.Pool;
  query<T extends DbRow = DbRow>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
  one<T extends DbRow = DbRow>(text: string, params?: unknown[]): Promise<T | undefined>;
  many<T extends DbRow = DbRow>(text: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

const SCHEMA_PATH = join(import.meta.dirname, 'schema.sql');

export function createDb(databaseUrl: string, poolSize: number, ssl = false): Db {
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const pool = new Pool({
    connectionString: databaseUrl,
    // node-postgres reads sslmode from the URL; this covers providers whose
    // connection string omits it. Certificates are still verified against the
    // system CA store.
    ...(ssl ? { ssl: true } : {}),
    max: poolSize,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'convertlab',
  });

  const db: Db = {
    pool,
    query: (text, params = []) => pool.query(text, params),
    async one(text, params = []) {
      const result = await pool.query(text, params);
      return result.rows[0];
    },
    async many(text, params = []) {
      const result = await pool.query(text, params);
      return result.rows;
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({
          query: (text, params = []) => client.query(text, params),
        });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
  return db;
}

export async function migrate(db: Db): Promise<void> {
  const schema = readFileSync(SCHEMA_PATH, 'utf8');
  const client = await db.pool.connect();
  try {
    // Serialise schema application across concurrently starting containers.
    await client.query('SELECT pg_advisory_lock(826196311)');
    await client.query(schema);
  } finally {
    await client.query('SELECT pg_advisory_unlock(826196311)').catch(() => {});
    client.release();
  }
}

export async function waitForDatabase(db: Db, attempts = 30): Promise<void> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await db.query('SELECT 1');
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000 + i * 250, 5000)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('database unavailable');
}

export function nowMs(): number {
  return Date.now();
}

/** Convert a bigint column supplied by node-postgres as a string. */
export function num(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}
