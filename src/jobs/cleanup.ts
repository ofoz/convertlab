import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppConfig } from '../config.ts';
import type { Db } from '../db/db.ts';
import { nowMs } from '../db/db.ts';
import { purgeExpiredSessions } from '../auth/session.ts';
import {
  clearArtifactPaths,
  listExpiredArtifacts,
  markCancelled,
  markExpiredFiles,
} from './store.ts';

type Logger = (level: 'info' | 'warn' | 'error', message: string, detail?: unknown) => void;

export type CleanupReport = {
  expiredFiles: number;
  removedArtifacts: number;
  cancelledQueued: number;
  purgedSessions: number;
  removedTempDirs: number;
};

export async function runCleanup(config: AppConfig, db: Db, log: Logger): Promise<CleanupReport> {
  // Session-level advisory locks belong to one backend connection, so acquire
  // and release it on the same client. Using the pool directly could take the
  // lock on one connection and try to release it on another, leaving the lock
  // behind for the lifetime of that backend.
  const client = await db.pool.connect();
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock(826196312) AS ok');
    if (lock.rows[0]?.ok !== true) {
      return { expiredFiles: 0, removedArtifacts: 0, cancelledQueued: 0, purgedSessions: 0, removedTempDirs: 0 };
    }
    try {
      return await runCleanupLocked(config, db, log);
    } finally {
      await client.query('SELECT pg_advisory_unlock(826196312)').catch((error) => {
        log('warn', 'cleanup lock release failed', { error: error instanceof Error ? error.message : String(error) });
      });
    }
  } finally {
    client.release();
  }
}

async function runCleanupLocked(config: AppConfig, db: Db, log: Logger): Promise<CleanupReport> {
  const now = nowMs();
  const report: CleanupReport = {
    expiredFiles: 0,
    removedArtifacts: 0,
    cancelledQueued: 0,
    purgedSessions: 0,
    removedTempDirs: 0,
  };

  const expired = await markExpiredFiles(db, now);
  report.expiredFiles = expired.files;

  const artifacts = await listExpiredArtifacts(db, now);
  const cleared: string[] = [];
  for (const file of artifacts) {
    for (const path of [file.output_path, file.source_path]) {
      if (!path) continue;
      try {
        await rm(path, { force: true });
        report.removedArtifacts += 1;
      } catch (error) {
        log('warn', 'artifact removal failed', { path, error: error instanceof Error ? error.message : String(error) });
      }
    }
    cleared.push(file.id);
  }
  await clearArtifactPaths(db, cleared);

  const cancelled = await db.many(
    "SELECT id FROM jobs WHERE cancel_requested = TRUE AND status IN ('queued','processing')",
  );
  for (const row of cancelled) {
    await markCancelled(db, String(row.id));
    report.cancelledQueued += 1;
  }

  report.purgedSessions = await purgeExpiredSessions(db);
  report.removedTempDirs = await cleanTemp(config.tmpDir, log);
  log('info', 'cleanup complete', report);
  return report;
}

async function cleanTemp(tmpDir: string, log: Logger): Promise<number> {
  const cutoff = nowMs() - 6 * 60 * 60 * 1000;
  let removed = 0;
  const entries = await readdir(tmpDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(tmpDir, entry.name);
    const info = await stat(path).catch(() => null);
    if (info && info.mtimeMs < cutoff) {
      await rm(path, { recursive: true, force: true }).catch((error) => {
        log('warn', 'temp directory removal failed', { path, error: error instanceof Error ? error.message : String(error) });
      });
      removed += 1;
    }
  }
  return removed;
}

export function startCleanupScheduler(config: AppConfig, db: Db, log: Logger): { stop(): void; runNow(): Promise<CleanupReport> } {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runCleanup(config, db, log);
    } catch (error) {
      log('error', 'cleanup failed', { error: error instanceof Error ? error.message : String(error) });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), 5 * 60 * 1000);
  timer.unref();
  setTimeout(() => void tick(), 15_000).unref();
  return {
    stop: () => clearInterval(timer),
    runNow: async () => {
      running = true;
      try {
        return await runCleanup(config, db, log);
      } finally {
        running = false;
      }
    },
  };
}
