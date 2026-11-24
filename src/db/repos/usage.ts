import type { Db } from '../db.ts';
import { num } from '../db.ts';

export function dayKey(timestamp = Date.now()): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export type UsageRow = { user_id: string; day: string; jobs: number; upload_bytes: number; output_bytes: number };

function mapUsage(row: Record<string, unknown>): UsageRow {
  return {
    user_id: String(row.user_id),
    day: String(row.day),
    jobs: num(row.jobs),
    upload_bytes: num(row.upload_bytes),
    output_bytes: num(row.output_bytes),
  };
}

export async function getUsage(db: Db, userId: string, day = dayKey()): Promise<UsageRow> {
  const row = await db.one('SELECT * FROM daily_usage WHERE user_id = $1 AND day = $2', [userId, day]);
  return row ? mapUsage(row) : { user_id: userId, day, jobs: 0, upload_bytes: 0, output_bytes: 0 };
}

export async function getQuotaSnapshot(
  db: Db,
  userId: string,
  day = dayKey(),
): Promise<{ day: string; jobs: number; uploadBytes: number; outputBytes: number }> {
  const usage = await getUsage(db, userId, day);
  return {
    day: usage.day,
    jobs: usage.jobs,
    uploadBytes: usage.upload_bytes,
    outputBytes: usage.output_bytes,
  };
}

export async function addJobUsage(db: Db, userId: string, uploadBytes: number, day = dayKey()): Promise<void> {
  await db.query(
    `INSERT INTO daily_usage (user_id, day, jobs, upload_bytes, output_bytes) VALUES ($1, $2, 1, $3, 0)
     ON CONFLICT(user_id, day) DO UPDATE SET jobs = daily_usage.jobs + 1, upload_bytes = daily_usage.upload_bytes + EXCLUDED.upload_bytes`,
    [userId, day, uploadBytes],
  );
}

export async function addOutputUsage(db: Db, userId: string, outputBytes: number, day = dayKey()): Promise<void> {
  await db.query(
    `INSERT INTO daily_usage (user_id, day, jobs, upload_bytes, output_bytes) VALUES ($1, $2, 0, 0, $3)
     ON CONFLICT(user_id, day) DO UPDATE SET output_bytes = daily_usage.output_bytes + EXCLUDED.output_bytes`,
    [userId, day, outputBytes],
  );
}

export async function listRecentUsage(db: Db, userId: string, days = 14): Promise<UsageRow[]> {
  const rows = await db.many('SELECT * FROM daily_usage WHERE user_id = $1 ORDER BY day DESC LIMIT $2', [userId, days]);
  return rows.map(mapUsage);
}

export async function usageTotals(db: Db): Promise<{ jobsToday: number; uploadBytesToday: number; outputBytesToday: number }> {
  const row = await db.one(
    `SELECT COALESCE(SUM(jobs),0)::int AS jobs, COALESCE(SUM(upload_bytes),0)::bigint AS upload_bytes,
            COALESCE(SUM(output_bytes),0)::bigint AS output_bytes
     FROM daily_usage WHERE day = CURRENT_DATE`,
  );
  return {
    jobsToday: num(row?.jobs),
    uploadBytesToday: num(row?.upload_bytes),
    outputBytesToday: num(row?.output_bytes),
  };
}
