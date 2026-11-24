import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db/db.ts';
import { nowMs, num } from '../db/db.ts';

export type SessionUser = {
  id: string;
  email: string;
  role: 'user' | 'admin';
  status: 'active' | 'disabled';
  sessionId: string;
  csrf: string;
  quotaJobs: number | null;
  quotaUploadBytes: number | null;
  quotaOutputBytes: number | null;
};

export const SESSION_COOKIE = 'cl_session';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(
  db: Db,
  userId: string,
  ttlDays: number,
  meta: { ip?: string; userAgent?: string } = {},
): Promise<{ token: string; csrf: string; expiresAt: number }> {
  const token = randomBytes(32).toString('base64url');
  const csrf = randomBytes(24).toString('base64url');
  const created = nowMs();
  const expiresAt = created + ttlDays * 24 * 60 * 60 * 1000;
  await db.query(
    `INSERT INTO sessions (id, user_id, csrf_token, ip, user_agent, created_at, last_seen_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6, $7)`,
    [hashToken(token), userId, csrf, meta.ip ?? null, (meta.userAgent ?? '').slice(0, 300), created, expiresAt],
  );
  return { token, csrf, expiresAt };
}

export async function resolveSession(db: Db, token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const row = await db.one(
    `SELECT s.id AS session_id, s.csrf_token, s.expires_at, s.revoked_at,
            u.id AS user_id, u.email, u.role, u.status,
            u.quota_jobs, u.quota_upload_bytes, u.quota_output_bytes
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = $1`,
    [hashToken(token)],
  );
  if (!row) return null;
  if (row.revoked_at !== null) return null;
  if (num(row.expires_at) <= nowMs()) return null;
  if (row.status !== 'active') return null;

  const touched = nowMs();
  await db.query('UPDATE sessions SET last_seen_at = $1 WHERE id = $2 AND last_seen_at < $3', [touched, row.session_id, touched - 60_000]);

  return {
    id: String(row.user_id),
    email: String(row.email),
    role: row.role === 'admin' ? 'admin' : 'user',
    status: 'active',
    sessionId: String(row.session_id),
    csrf: String(row.csrf_token),
    quotaJobs: row.quota_jobs === null ? null : num(row.quota_jobs),
    quotaUploadBytes: row.quota_upload_bytes === null ? null : num(row.quota_upload_bytes),
    quotaOutputBytes: row.quota_output_bytes === null ? null : num(row.quota_output_bytes),
  };
}

export async function revokeSession(db: Db, sessionId: string): Promise<void> {
  await db.query('UPDATE sessions SET revoked_at = $1 WHERE id = $2', [nowMs(), sessionId]);
}

export async function revokeAllSessions(db: Db, userId: string, exceptSessionId?: string): Promise<number> {
  const result = await db.query(
    'UPDATE sessions SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL AND id <> $3',
    [nowMs(), userId, exceptSessionId ?? ''],
  );
  return result.rowCount ?? 0;
}

export async function purgeExpiredSessions(db: Db, olderThanMs = 7 * 24 * 60 * 60 * 1000): Promise<number> {
  const result = await db.query('DELETE FROM sessions WHERE expires_at < $1 AND revoked_at IS NOT NULL', [nowMs() - olderThanMs]);
  return result.rowCount ?? 0;
}
