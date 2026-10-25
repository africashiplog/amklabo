import { Pool, types, type PoolClient, type QueryResultRow } from "pg";

// BIGINT (montants en unités mineures, compteurs) → number. Les montants restent
// très en dessous de Number.MAX_SAFE_INTEGER (≈ 9·10^15).
types.setTypeParser(20, (v) => Number(v));
// DATE → chaîne "AAAA-MM-JJ" (pas de conversion de fuseau horaire).
types.setTypeParser(1082, (v) => v);

declare global {
  // eslint-disable-next-line no-var
  var __amklaboPool: Pool | undefined;
}

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL n'est pas défini");
  return new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
}

export function pool(): Pool {
  if (!globalThis.__amklaboPool) globalThis.__amklaboPool = createPool();
  return globalThis.__amklaboPool;
}

export type Db = Pool | PoolClient;

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
  db: Db = pool(),
): Promise<T[]> {
  const res = await db.query<T>(sql, params);
  return res.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
  db: Db = pool(),
): Promise<T | null> {
  const rows = await query<T>(sql, params, db);
  return rows[0] ?? null;
}

/** Exécute `fn` dans une transaction ; annule tout en cas d'erreur. */
export async function tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Code d'erreur PostgreSQL (23505 = unicité, 23503 = clé étrangère…). */
export function pgCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : undefined;
}
