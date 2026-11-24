import type { JobFileRow, JobRow } from './store.ts';

export function publicFile(file: JobFileRow) {
  return {
    id: file.id,
    name: file.original_name,
    sourceExt: file.source_ext,
    sourceSize: file.source_size,
    status: file.status,
    progress: file.progress,
    outputExt: file.output_ext,
    outputSize: file.output_size,
    error: file.error,
    durationMs: file.duration_ms,
    expiresAt: file.expires_at,
  };
}

export function publicJob(job: JobRow, files: JobFileRow[]) {
  return {
    id: job.id,
    status: job.status,
    target: job.target,
    options: job.options ?? {},
    totalFiles: job.total_files,
    doneFiles: job.done_files,
    failedFiles: job.failed_files,
    progress: job.progress,
    error: job.error,
    cancelRequested: job.cancel_requested,
    createdAt: job.created_at,
    startedAt: job.started_at,
    finishedAt: job.finished_at,
    expiresAt: job.expires_at,
    files: files.map(publicFile),
  };
}
