import { rm } from 'node:fs/promises';
import type { Db } from '../db/db.ts';
import { nowMs } from '../db/db.ts';
import { clearArtifactPaths, listExpiredArtifacts, markExpiredFiles } from './store.ts';

type Logger = (level: 'info' | 'warn' | 'error', message: string, detail?: unknown) => void;

export async function recoverExpiredArtifacts(db: Db, log: Logger): Promise<void> {
  const now = nowMs();
  await markExpiredFiles(db, now);
  const rows = await listExpiredArtifacts(db, now);
  for (const file of rows) {
    for (const path of [file.output_path, file.source_path]) {
      if (path) await rm(path, { force: true }).catch(() => {});
    }
  }
  await clearArtifactPaths(db, rows.map((row) => row.id));
  if (rows.length) log('info', 'expired artefacts recovered', { files: rows.length });
}
