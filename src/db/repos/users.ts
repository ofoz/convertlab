import { randomUUID } from 'node:crypto';
import type { Db, DbRow } from '../db.ts';
import { nowMs, num } from '../db.ts';

export type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  role: 'user' | 'admin';
  status: 'active' | 'disabled';
  quota_jobs: number | null;
  quota_upload_bytes: number | null;
  quota_output_bytes: number | null;
  created_at: number;
  updated_at: number;
  last_login_at: number | null;
  disabled_reason: string | null;
};

export type PublicUser = {
  id: string;
  email: string;
  role: 'user' | 'admin';
  status: 'active' | 'disabled';
  createdAt: number;
  lastLoginAt: number | null;
  disabledReason: string | null;
  quotas: { jobs: number | null; uploadBytes: number | null; outputBytes: number | null };
};

function mapUser(row: DbRow): UserRow {
  return {
    id: String(row.id),
    email: String(row.email),
    password_hash: String(row.password_hash),
    role: row.role === 'admin' ? 'admin' : 'user',
    status: row.status === 'disabled' ? 'disabled' : 'active',
    quota_jobs: row.quota_jobs === null ? null : num(row.quota_jobs),
    quota_upload_bytes: row.quota_upload_bytes === null ? null : num(row.quota_upload_bytes),
    quota_output_bytes: row.quota_output_bytes === null ? null : num(row.quota_output_bytes),
    created_at: num(row.created_at),
    updated_at: num(row.updated_at),
    last_login_at: row.last_login_at === null ? null : num(row.last_login_at),
    disabled_reason: row.disabled_reason === null ? null : String(row.disabled_reason),
  };
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    disabledReason: row.disabled_reason,
    quotas: {
      jobs: row.quota_jobs,
      uploadBytes: row.quota_upload_bytes,
      outputBytes: row.quota_output_bytes,
    },
  };
}

export async function findByEmail(db: Db, email: string): Promise<UserRow | undefined> {
  const row = await db.one('SELECT * FROM users WHERE email = $1', [email.trim().toLowerCase()]);
  return row ? mapUser(row) : undefined;
}

export async function findById(db: Db, id: string): Promise<UserRow | undefined> {
  const row = await db.one('SELECT * FROM users WHERE id = $1', [id]);
  return row ? mapUser(row) : undefined;
}

export async function countUsers(db: Db): Promise<number> {
  const row = await db.one('SELECT COUNT(*)::int AS n FROM users');
  return num(row?.n);
}

export async function countActiveAdmins(db: Db): Promise<number> {
  const row = await db.one("SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin' AND status = 'active'");
  return num(row?.n);
}

export async function createUser(
  db: Db,
  input: { email: string; passwordHash: string; role?: 'user' | 'admin'; status?: 'active' | 'disabled' },
): Promise<UserRow> {
  const timestamp = nowMs();
  const id = randomUUID();
  await db.query(
    `INSERT INTO users (id, email, password_hash, role, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, input.email.trim().toLowerCase(), input.passwordHash, input.role ?? 'user', input.status ?? 'active', timestamp, timestamp],
  );
  const created = await findById(db, id);
  if (!created) throw new Error('user insert failed');
  return created;
}

export async function touchLogin(db: Db, userId: string): Promise<void> {
  const timestamp = nowMs();
  await db.query('UPDATE users SET last_login_at = $1, updated_at = $1 WHERE id = $2', [timestamp, userId]);
}

export async function updatePassword(db: Db, userId: string, passwordHash: string): Promise<void> {
  await db.query('UPDATE users SET password_hash = $1, updated_at = $2 WHERE id = $3', [passwordHash, nowMs(), userId]);
}

export async function setStatus(db: Db, userId: string, status: 'active' | 'disabled', reason: string | null): Promise<void> {
  await db.query('UPDATE users SET status = $1, disabled_reason = $2, updated_at = $3 WHERE id = $4', [status, reason, nowMs(), userId]);
}

export async function setQuotas(
  db: Db,
  userId: string,
  quotas: { jobs: number | null; uploadBytes: number | null; outputBytes: number | null },
): Promise<void> {
  await db.query(
    'UPDATE users SET quota_jobs = $1, quota_upload_bytes = $2, quota_output_bytes = $3, updated_at = $4 WHERE id = $5',
    [quotas.jobs, quotas.uploadBytes, quotas.outputBytes, nowMs(), userId],
  );
}

export async function listUsers(db: Db, opts: { limit: number; offset: number; search?: string }): Promise<{ total: number; rows: UserRow[] }> {
  const like = opts.search ? `%${opts.search.toLowerCase()}%` : null;
  const where = like ? 'WHERE lower(email) LIKE $1' : '';
  const params: unknown[] = like ? [like] : [];
  const totalRow = await db.one(`SELECT COUNT(*)::int AS n FROM users ${where}`, params);
  const rows = await db.many(
    `SELECT * FROM users ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, opts.limit, opts.offset],
  );
  return { total: num(totalRow?.n), rows: rows.map(mapUser) };
}
