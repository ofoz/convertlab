import { randomUUID } from 'node:crypto';
import type { Db } from '../db.ts';
import { nowMs, num } from '../db.ts';

export type AuditRow = {
  id: string;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: unknown;
  ip: string | null;
  created_at: number;
};

export async function writeAudit(
  db: Db,
  input: { actorId: string | null; action: string; targetType?: string | null; targetId?: string | null; detail?: unknown; ip?: string | null },
): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, detail, ip, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      randomUUID(),
      input.actorId,
      input.action,
      input.targetType ?? null,
      input.targetId ?? null,
      input.detail === undefined ? null : JSON.stringify(input.detail),
      input.ip ?? null,
      nowMs(),
    ],
  );
}

export async function listAudit(db: Db, opts: { limit: number; offset: number; action?: string }): Promise<{ total: number; rows: AuditRow[] }> {
  const like = opts.action ? `%${opts.action}%` : null;
  const where = like ? 'WHERE action LIKE $1' : '';
  const params: unknown[] = like ? [like] : [];
  const totalRow = await db.one(`SELECT COUNT(*)::int AS n FROM audit_logs ${where}`, params);
  const rows = await db.many(
    `SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, opts.limit, opts.offset],
  );
  return {
    total: num(totalRow?.n),
    rows: rows.map((row) => ({
      id: String(row.id),
      actor_id: row.actor_id === null ? null : String(row.actor_id),
      action: String(row.action),
      target_type: row.target_type === null ? null : String(row.target_type),
      target_id: row.target_id === null ? null : String(row.target_id),
      detail: row.detail,
      ip: row.ip === null ? null : String(row.ip),
      created_at: num(row.created_at),
    })),
  };
}
