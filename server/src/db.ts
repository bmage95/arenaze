// Postgres pool + transaction helpers.
//
// Helpers:
//  - query()             : one-off query on the pool
//  - withTransaction()   : BEGIN/COMMIT (ROLLBACK on throw)
//  - withSerializable()  : BEGIN ISOLATION LEVEL SERIALIZABLE, retry on 40001
//                          (serialization_failure) up to 3 times; exclusion
//                          violations (23P01) are surfaced to the caller.
import pg from 'pg';
import type { Pool as PoolType, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { config } from './config.js';

const { Pool, types } = pg;

// Return timestamptz / timestamp as ISO-8601 strings so DTOs never leak Date
// objects. All wire timestamps are ISO strings per the API contract.
types.setTypeParser(1184, (v: string) => new Date(v).toISOString()); // timestamptz
types.setTypeParser(1114, (v: string) => new Date(v).toISOString()); // timestamp

export const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

export type Db = PoolType | PoolClient;

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
  client: Db = pool,
): Promise<QueryResult<T>> {
  return client.query<T>(text, params as any[]);
}

/** Plain transaction: COMMIT on success, ROLLBACK on throw. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const SERIALIZATION_FAILURE = '40001';
const MAX_SERIALIZABLE_ATTEMPTS = 3;

function pgCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? (err as { code?: string }).code
    : undefined;
}

/**
 * SERIALIZABLE transaction with retry-on-conflict. Retries SQLSTATE 40001
 * (serialization_failure) up to MAX_SERIALIZABLE_ATTEMPTS. Exclusion-constraint
 * violations (23P01) and any other error are surfaced to the caller immediately.
 */
export async function withSerializable<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      lastErr = err;
      if (pgCode(err) === SERIALIZATION_FAILURE && attempt < MAX_SERIALIZABLE_ATTEMPTS) {
        continue; // transient serialization conflict — retry
      }
      throw err; // 23P01 and everything else surface to the caller
    } finally {
      client.release();
    }
  }
  throw lastErr;
}

export const PG = {
  SERIALIZATION_FAILURE,
  EXCLUSION_VIOLATION: '23P01',
  UNIQUE_VIOLATION: '23505',
  code: pgCode,
} as const;
