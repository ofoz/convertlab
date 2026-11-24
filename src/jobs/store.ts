import { randomUUID } from 'node:crypto';
import type { Db, DbRow, Queryable } from '../db/db.ts';
import { nowMs, num } from '../db/db.ts';
import type { ConversionOptions } from '../converters/formats.ts';

export type JobStatus = 'queued' | 'processing' | 'success' | 'partial' | 'failed' | 'cancelled';
export type FileStatus = 'queued' | 'processing' | 'success' | 'failed' | 'expired' | 'cancelled';

export type JobRow = {
  id: string;
  user_id: string;
  status: JobStatus;
  target: string;
  options: ConversionOptions;
  total_files: number;
  done_files: number;
  failed_files: number;
  progress: number;
  error: string | null;
  cancel_requested: boolean;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  expires_at: number;
};

export type JobFileRow = {
  id: string;
  job_id: string;
  position: number;
  original_name: string;
  source_ext: string;
  source_mime: string;
  source_size: number;
  source_path: string;
  output_ext: string | null;
  output_path: string | null;
  output_size: number | null;
  status: FileStatus;
  progress: number;
  error: string | null;
  duration_ms: number | null;
  created_at: number;
  expires_at: number;
};

export type NewFileInput = {
  originalName: string;
  sourceExt: string;
  sourceMime: string;
  sourceSize: number;
  sourcePath: string;
};

function mapJob(row: DbRow): JobRow {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    status: String(row.status) as JobStatus,
    target: String(row.target),
    options: (row.options ?? {}) as ConversionOptions,
    total_files: num(row.total_files),
    done_files: num(row.done_files),
    failed_files: num(row.failed_files),
    progress: num(row.progress),
    error: row.error === null ? null : String(row.error),
    cancel_requested: row.cancel_requested === true,
    created_at: num(row.created_at),
    started_at: row.started_at === null ? null : num(row.started_at),
    finished_at: row.finished_at === null ? null : num(row.finished_at),
    expires_at: num(row.expires_at),
  };
}

function mapFile(row: DbRow): JobFileRow {
  return {
    id: String(row.id),
    job_id: String(row.job_id),
    position: num(row.position),
    original_name: String(row.original_name),
    source_ext: String(row.source_ext),
    source_mime: String(row.source_mime),
    source_size: num(row.source_size),
    source_path: String(row.source_path),
    output_ext: row.output_ext === null ? null : String(row.output_ext),
    output_path: row.output_path === null ? null : String(row.output_path),
    output_size: row.output_size === null ? null : num(row.output_size),
    status: String(row.status) as FileStatus,
    progress: num(row.progress),
    error: row.error === null ? null : String(row.error),
    duration_ms: row.duration_ms === null ? null : num(row.duration_ms),
    created_at: num(row.created_at),
    expires_at: num(row.expires_at),
  };
}

export async function createJob(
  db: Db,
  input: { userId: string; target: string; options: ConversionOptions; files: NewFileInput[]; ttlMs: number },
): Promise<{ job: JobRow; files: JobFileRow[] }> {
  const jobId = randomUUID();
  const now = nowMs();
  const expiresAt = now + input.ttlMs;
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO jobs (id, user_id, status, target, options, total_files, done_files, failed_files, progress, cancel_requested, created_at, expires_at)
       VALUES ($1, $2, 'queued', $3, $4::jsonb, $5, 0, 0, 0, FALSE, $6, $7)`,
      [jobId, input.userId, input.target, JSON.stringify(input.options), input.files.length, now, expiresAt],
    );
    for (const [position, file] of input.files.entries()) {
      await tx.query(
        `INSERT INTO job_files (id, job_id, position, original_name, source_ext, source_mime, source_size, source_path, status, progress, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'queued', 0, $9, $10)`,
        [randomUUID(), jobId, position, file.originalName.slice(0, 255), file.sourceExt, file.sourceMime, file.sourceSize, file.sourcePath, now, expiresAt],
      );
    }
  });
  const job = await getJob(db, jobId);
  if (!job) throw new Error('job insert failed');
  return { job, files: await getJobFiles(db, jobId) };
}

export async function getJob(db: Db | Queryable, id: string): Promise<JobRow | undefined> {
  const result = await db.query('SELECT * FROM jobs WHERE id = $1', [id]);
  return result.rows[0] ? mapJob(result.rows[0]) : undefined;
}

export async function getJobFiles(db: Db | Queryable, jobId: string): Promise<JobFileRow[]> {
  const result = await db.query('SELECT * FROM job_files WHERE job_id = $1 ORDER BY position', [jobId]);
  return result.rows.map(mapFile);
}

export async function getJobFile(db: Db | Queryable, id: string): Promise<JobFileRow | undefined> {
  const result = await db.query('SELECT * FROM job_files WHERE id = $1', [id]);
  return result.rows[0] ? mapFile(result.rows[0]) : undefined;
}

export async function listJobs(db: Db, userId: string, opts: { limit: number; offset: number }): Promise<{ total: number; rows: JobRow[] }> {
  const totalRow = await db.one('SELECT COUNT(*)::int AS n FROM jobs WHERE user_id = $1', [userId]);
  const rows = await db.many('SELECT * FROM jobs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3', [userId, opts.limit, opts.offset]);
  return { total: num(totalRow?.n), rows: rows.map(mapJob) };
}

export async function listAllJobs(
  db: Db,
  opts: { limit: number; offset: number; status?: string; search?: string },
): Promise<{ total: number; rows: Array<JobRow & { email: string }> }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (opts.status) {
    params.push(opts.status);
    conditions.push(`j.status = $${params.length}`);
  }
  if (opts.search) {
    params.push(`%${opts.search.toLowerCase()}%`);
    conditions.push(`(lower(u.email) LIKE $${params.length} OR j.id::text = $${params.length + 1})`);
    params.push(opts.search.toLowerCase());
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const totalRow = await db.one(`SELECT COUNT(*)::int AS n FROM jobs j JOIN users u ON u.id = j.user_id ${where}`, params);
  const rows = await db.many(
    `SELECT j.*, u.email FROM jobs j JOIN users u ON u.id = j.user_id ${where}
     ORDER BY j.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, opts.limit, opts.offset],
  );
  return { total: num(totalRow?.n), rows: rows.map((row) => ({ ...mapJob(row), email: String(row.email) })) };
}

export async function updateJobStatus(
  db: Db | Queryable,
  id: string,
  status: JobStatus,
  fields: { error?: string | null; started?: boolean; finished?: boolean } = {},
): Promise<void> {
  const now = nowMs();
  await db.query(
    `UPDATE jobs SET status = $1, error = COALESCE($2, error),
      started_at = CASE WHEN $3::boolean THEN COALESCE(started_at, $4) ELSE started_at END,
      finished_at = CASE WHEN $5::boolean THEN $4 ELSE finished_at END
     WHERE id = $6`,
    [status, fields.error === undefined ? null : fields.error, fields.started === true, now, fields.finished === true, id],
  );
}

export async function updateFileStatus(
  db: Db,
  id: string,
  status: FileStatus,
  fields: { progress?: number; outputExt?: string | null; outputPath?: string | null; outputSize?: number | null; error?: string | null; durationMs?: number | null } = {},
): Promise<void> {
  const current = await getJobFile(db, id);
  if (!current) return;
  await db.query(
    `UPDATE job_files SET status = $1, progress = COALESCE($2, progress), output_ext = COALESCE($3, output_ext),
      output_path = COALESCE($4, output_path), output_size = COALESCE($5, output_size), error = $6, duration_ms = COALESCE($7, duration_ms)
     WHERE id = $8`,
    [
      status,
      fields.progress === undefined ? null : fields.progress,
      fields.outputExt === undefined ? null : fields.outputExt,
      fields.outputPath === undefined ? null : fields.outputPath,
      fields.outputSize === undefined ? null : fields.outputSize,
      fields.error === undefined ? null : fields.error,
      fields.durationMs === undefined ? null : fields.durationMs,
      id,
    ],
  );
  await recalculateJob(db, current.job_id);
}

export async function updateFileProgress(db: Db, id: string, progress: number): Promise<void> {
  const file = await getJobFile(db, id);
  if (!file) return;
  await db.query(
    "UPDATE job_files SET progress = $1, status = CASE WHEN status = 'queued' THEN 'processing' ELSE status END WHERE id = $2",
    [Math.max(0, Math.min(99, Math.round(progress))), id],
  );
  await recalculateJob(db, file.job_id);
}

export async function recalculateJob(db: Db, jobId: string): Promise<void> {
  const job = await getJob(db, jobId);
  if (!job) return;
  const files = await getJobFiles(db, jobId);
  const total = files.length;
  const done = files.filter((f) => ['success', 'failed', 'expired', 'cancelled'].includes(f.status)).length;
  const failed = files.filter((f) => ['failed', 'expired', 'cancelled'].includes(f.status)).length;
  const progress = total === 0 ? 0 : Math.round(files.reduce((sum, f) => sum + (['success', 'failed', 'expired', 'cancelled'].includes(f.status) ? 100 : f.progress), 0) / total);

  // Cancelled is a terminal operator/user intent and must not be replaced by a
  // derived partial/failed status when the in-flight file settles.
  if (job.status === 'cancelled') {
    await db.query('UPDATE jobs SET total_files = $1, done_files = $2, failed_files = $3, progress = $4 WHERE id = $5', [
      total, done, failed, progress, jobId,
    ]);
    return;
  }

  let status: JobStatus | null = null;
  if (done === total && total > 0) status = failed === 0 ? 'success' : failed === total ? 'failed' : 'partial';
  else if (files.some((f) => f.status === 'processing')) status = 'processing';

  if (status) {
    await db.query(
      `UPDATE jobs SET total_files = $1, done_files = $2, failed_files = $3, progress = $4, status = $5,
       finished_at = COALESCE(finished_at, $6) WHERE id = $7`,
      [total, done, failed, progress, status, nowMs(), jobId],
    );
  } else {
    await db.query('UPDATE jobs SET total_files = $1, done_files = $2, failed_files = $3, progress = $4 WHERE id = $5', [
      total, done, failed, progress, jobId,
    ]);
  }
}

/** Atomically claim one queued job; safe with multiple worker containers. */
export async function claimNextJob(db: Db): Promise<JobRow | null> {
  return db.transaction(async (tx) => {
    const result = await tx.query(
      `SELECT id FROM jobs
       WHERE status = 'queued' AND cancel_requested = FALSE
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
    );
    const row = result.rows[0];
    if (!row) return null;
    await tx.query("UPDATE jobs SET status = 'processing', started_at = COALESCE(started_at, $1) WHERE id = $2", [nowMs(), row.id]);
    const updated = await tx.query('SELECT * FROM jobs WHERE id = $1', [row.id]);
    return updated.rows[0] ? mapJob(updated.rows[0]) : null;
  });
}

export async function requestCancel(db: Db, jobId: string): Promise<void> {
  await db.query('UPDATE jobs SET cancel_requested = TRUE WHERE id = $1', [jobId]);
}

export async function isCancelRequested(db: Db, jobId: string): Promise<boolean> {
  const row = await db.one('SELECT cancel_requested FROM jobs WHERE id = $1', [jobId]);
  return row?.cancel_requested === true;
}

export async function markCancelled(db: Db, jobId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query(
      "UPDATE job_files SET status = 'cancelled', error = CASE WHEN status IN ('queued','processing') THEN '任务已取消' ELSE error END WHERE job_id = $1",
      [jobId],
    );
    await tx.query("UPDATE jobs SET status = 'cancelled', cancel_requested = TRUE, finished_at = COALESCE(finished_at, $1) WHERE id = $2", [nowMs(), jobId]);
  });
  await recalculateJob(db, jobId);
}

export async function markExpiredFiles(db: Db, now = nowMs()): Promise<{ files: number; jobs: number }> {
  const files = await db.query(
    "UPDATE job_files SET status = 'expired' WHERE expires_at <= $1 AND status IN ('queued','processing','success')",
    [now],
  );
  // Keep the historical job outcome but signal that downloadable artefacts are gone.
  const jobs = await db.query(
    "UPDATE jobs SET error = COALESCE(error, '结果文件已过期清理') WHERE expires_at <= $1",
    [now],
  );
  return { files: files.rowCount ?? 0, jobs: jobs.rowCount ?? 0 };
}

export async function listExpiredArtifacts(db: Db, now = nowMs()): Promise<JobFileRow[]> {
  const rows = await db.many(
    "SELECT * FROM job_files WHERE expires_at <= $1 AND (output_path IS NOT NULL OR source_path IS NOT NULL) LIMIT 5000",
    [now],
  );
  return rows.map(mapFile);
}

export async function clearArtifactPaths(db: Db, fileIds: string[]): Promise<void> {
  if (fileIds.length === 0) return;
  await db.query(
    "UPDATE job_files SET output_path = NULL, output_size = NULL, source_path = '' WHERE id = ANY($1::uuid[])",
    [fileIds],
  );
}

export async function jobStats(db: Db): Promise<Record<string, number>> {
  const rows = await db.many('SELECT status, COUNT(*)::int AS n FROM jobs GROUP BY status');
  const out: Record<string, number> = { queued: 0, processing: 0, success: 0, partial: 0, failed: 0, cancelled: 0, total: 0 };
  for (const row of rows) {
    const count = num(row.n);
    out[String(row.status)] = count;
    out['total'] = (out['total'] ?? 0) + count;
  }
  return out;
}
