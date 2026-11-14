import { readFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config, repoRoot } from '../config.ts';

/**
 * Thin database adapter. Uses embedded PGlite (real Postgres compiled to WASM) for local/dev,
 * or a pg Pool when DATABASE_URL is set (Cloud SQL / any Postgres) for production.
 */
type Row = Record<string, any>;
interface Adapter {
  query(sql: string, params?: any[]): Promise<{ rows: Row[] }>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

let adapter: Adapter | null = null;
let ready: Promise<Adapter> | null = null;

async function createAdapter(): Promise<Adapter> {
  if (config.databaseUrl) {
    const pg = await import('pg');
    const pool = new pg.default.Pool({ connectionString: config.databaseUrl });
    return {
      query: (sql, params = []) => pool.query(sql, params) as any,
      exec: async (sql) => { await pool.query(sql); },
      close: () => pool.end(),
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const dir =
    process.env.NODE_ENV === 'test'
      ? 'memory://'
      : config.dataDir;
  if (!dir.startsWith('memory://')) {
    mkdirSync(dir, { recursive: true });
    const pidFile = path.join(dir, 'postmaster.pid');
    if (existsSync(pidFile)) {
      try {
        unlinkSync(pidFile);
      } catch {}
    }
  }
  let db: any;
  try {
    db = await PGlite.create(dir.startsWith('memory://') ? undefined : dir);
  } catch {
    const recoveryDir = `${dir}-live`;
    mkdirSync(recoveryDir, { recursive: true });
    const recPid = path.join(recoveryDir, 'postmaster.pid');
    if (existsSync(recPid)) {
      try {
        unlinkSync(recPid);
      } catch {}
    }
    try {
      db = await PGlite.create(recoveryDir);
    } catch {
      db = await PGlite.create();
    }
  }
  return {
    query: (sql, params = []) => db.query(sql, params) as any,
    exec: async (sql) => { await db.exec(sql); },
    close: () => db.close(),
  };
}

function loadSchemaSql(): string {
  const candidates = [
    path.join(repoRoot, 'server', 'src', 'db', 'schema.sql'),
    path.join(repoRoot, 'api', 'schema.sql'),
    new URL('../server/src/db/schema.sql', import.meta.url),
    new URL('./schema.sql', import.meta.url),
  ];
  for (const candidate of candidates) {
    try {
      return readFileSync(candidate as any, 'utf8');
    } catch {}
  }
  const cwdFallback = path.resolve(process.cwd(), 'server/src/db/schema.sql');
  return readFileSync(cwdFallback, 'utf8');
}

export async function getDb(): Promise<Adapter> {
  if (adapter) return adapter;
  if (!ready) {
    ready = (async () => {
      const a = await createAdapter();
      const schema = loadSchemaSql();
      await a.exec(schema);
      try {
        await a.exec(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_meet_url TEXT;`);
        await a.exec(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();`);
      } catch {}
      adapter = a;
      try {
        const { ensureSeeded } = await import('./seed.ts');
        await ensureSeeded();
      } catch (err) {
        console.error('Seed error:', err);
      }
      return a;
    })();
  }
  return ready;
}

export async function closeDb() {
  if (adapter) await adapter.close();
  adapter = null;
  ready = null;
}

export async function q<T = Row>(sql: string, params: any[] = []): Promise<T[]> {
  const db = await getDb();
  const res = await db.query(sql, params.map(normalizeParam));
  return res.rows as T[];
}

export async function one<T = Row>(sql: string, params: any[] = []): Promise<T | null> {
  const rows = await q<T>(sql, params);
  return rows[0] ?? null;
}

function normalizeParam(v: any) {
  if (v === undefined) return null;
  if (Array.isArray(v)) return v;
  if (v !== null && typeof v === 'object' && !(v instanceof Date)) return JSON.stringify(v);
  return v;
}

export const uid = () => randomUUID();

const JSONB_COLUMNS = new Set(['states', 'lines', 'products', 'automation', 'meta', 'details', 'mentions', 'intake', 'google_tokens']);

function sanitizeForDb(data: Row): Row {
  const sanitized: Row = {};
  for (const [k, v] of Object.entries(data)) {
    if (JSONB_COLUMNS.has(k) && typeof v === 'object' && v !== null) {
      sanitized[k] = JSON.stringify(v);
    } else {
      sanitized[k] = v;
    }
  }
  return sanitized;
}

/** Insert a row; unknown keys must be filtered by caller. Returns inserted row. */
export async function insert<T extends Row = Row>(table: string, data: Row): Promise<T> {
  const row = sanitizeForDb({ id: data.id ?? uid(), ...data });
  const keys = Object.keys(row);
  const cols = keys.map((k) => `"${k}"`).join(',');
  const vals = keys.map((_, i) => `$${i + 1}`).join(',');
  const res = await one<T>(`INSERT INTO ${table} (${cols}) VALUES (${vals}) RETURNING *`, keys.map((k) => row[k]));
  return res!;
}

export async function update(table: string, id: string, data: Row): Promise<Row | null> {
  const sanitized = sanitizeForDb(data);
  const keys = Object.keys(sanitized).filter((k) => k !== 'id');
  if (!keys.length) return one(`SELECT * FROM ${table} WHERE id=$1`, [id]);
  const hasUpdated = ['leads', 'clients', 'opportunities', 'policies', 'commissions', 'activities', 'conversations'].includes(table);
  const sets = keys.map((k, i) => `"${k}"=$${i + 2}`);
  if (hasUpdated && !keys.includes('updated_at')) sets.push('updated_at=now()');
  return one(`UPDATE ${table} SET ${sets.join(',')} WHERE id=$1 RETURNING *`, [id, ...keys.map((k) => sanitized[k])]);
}

export async function audit(userId: string | null, action: string, entity: string, entityId: string, details: Row = {}) {
  await insert('audit_log', { user_id: userId, action, entity, entity_id: entityId, details });
}
