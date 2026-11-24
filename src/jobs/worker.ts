import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import type { AppConfig } from '../config.ts';
import type { Db } from '../db/db.ts';
import { nowMs, num } from '../db/db.ts';
import { runConversion } from '../converters/dispatch.ts';
import type { ConversionOptions } from '../converters/formats.ts';
import { friendlyCommandError } from '../converters/process.ts';
import { ConversionError } from '../converters/types.ts';
import { addOutputUsage } from '../db/repos/usage.ts';
import {
  claimNextJob,
  getJob,
  getJobFiles,
  isCancelRequested,
  markCancelled,
  recalculateJob,
  updateFileProgress,
  updateFileStatus,
  updateJobStatus,
  type JobFileRow,
  type JobRow,
} from './store.ts';

type Logger = (level: 'info' | 'warn' | 'error', message: string, detail?: unknown) => void;

export type WorkerPoolOptions = {
  config: AppConfig;
  db: Db;
  log: Logger;
  concurrency?: number;
};

type QueuePayload = { jobId: string };

export class WorkerPool {
  private readonly config: AppConfig;
  private readonly db: Db;
  private readonly log: Logger;
  private readonly concurrency: number;
  private readonly aborters = new Map<string, AbortController>();
  private connection: Redis | null = null;
  private queue: Queue<QueuePayload> | null = null;
  private worker: Worker<QueuePayload> | null = null;
  private started = false;

  constructor(options: WorkerPoolOptions) {
    this.config = options.config;
    this.db = options.db;
    this.log = options.log;
    this.concurrency = options.concurrency ?? options.config.workerConcurrency;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.connection = new Redis(this.config.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    this.connection.on('error', (error: Error) => this.log('warn', 'redis connection error', { error: error.message }));
    this.queue = new Queue<QueuePayload>(this.config.queueName, { connection: this.connection });

    if (this.config.processRole === 'web') {
      this.log('info', 'queue producer started (web role)');
      return;
    }

    await this.recoverStaleJobs();
    this.worker = new Worker<QueuePayload>(
      this.config.queueName,
      async (job: Job<QueuePayload>) => this.handleQueueJob(job),
      {
        connection: this.connection,
        concurrency: this.concurrency,
        lockDuration: Math.max(60_000, this.config.jobTimeoutMs + 60_000),
        stalledInterval: 60_000,
        maxStalledCount: 1,
      },
    );
    this.worker.on('failed', (job, error) => {
      this.log('error', 'queue job failed', { jobId: job?.data?.jobId, error: error.message, attempts: job?.attemptsMade });
    });
    this.worker.on('error', (error: Error) => this.log('error', 'worker error', { error: error.message }));
    this.log('info', `BullMQ worker started with concurrency ${this.concurrency}`);
  }

  async stop(): Promise<void> {
    this.started = false;
    for (const controller of this.aborters.values()) controller.abort();
    this.aborters.clear();
    if (this.worker) await this.worker.close();
    if (this.queue) await this.queue.close();
    if (this.connection) this.connection.disconnect();
    this.worker = null;
    this.queue = null;
    this.connection = null;
  }

  get activeCount(): number {
    return this.aborters.size;
  }

  async ping(): Promise<boolean> {
    if (!this.connection) return false;
    return (await this.connection.ping()) === 'PONG';
  }

  async enqueue(jobId: string): Promise<void> {
    if (!this.queue) throw new Error('job queue is not started');
    await this.queue.add('convert', { jobId }, {
      jobId,
      attempts: 2,
      backoff: { type: 'fixed', delay: 3000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    });
  }

  cancel(jobId: string): boolean {
    const controller = this.aborters.get(jobId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  private async recoverStaleJobs(): Promise<void> {
    const threshold = nowMs() - Math.max(this.config.jobTimeoutMs * 2, 10 * 60 * 1000);
    const rows = await this.db.many("SELECT id FROM jobs WHERE status = 'processing' AND COALESCE(started_at, 0) < $1", [threshold]);
    for (const row of rows) {
      const jobId = String(row.id);
      await this.db.transaction(async (tx) => {
        await tx.query("UPDATE job_files SET status = 'queued', progress = 0 WHERE job_id = $1 AND status = 'processing'", [jobId]);
        await tx.query("UPDATE jobs SET status = 'queued', started_at = NULL WHERE id = $1", [jobId]);
      });
      await this.enqueue(jobId);
      this.log('warn', 'requeued stale job', { jobId });
    }
  }

  private async handleQueueJob(queueJob: Job<QueuePayload>): Promise<void> {
    const { jobId } = queueJob.data;
    let job: JobRow | null = null;

    // The BullMQ job is only a wakeup signal. Claiming through PostgreSQL makes
    // the database the source of truth even if Redis loses or duplicates a job.
    if (queueJob.attemptsMade === 0) {
      job = await getJob(this.db, jobId) ?? null;
      if (!job || job.status !== 'queued') return;
      await this.db.query("UPDATE jobs SET status = 'processing', started_at = COALESCE(started_at, $1) WHERE id = $2 AND status = 'queued'", [nowMs(), jobId]);
      job = await getJob(this.db, jobId) ?? null;
    } else {
      // A retry after a worker crash: reset any in-flight file before resuming.
      await this.db.query("UPDATE job_files SET status = 'queued', progress = 0 WHERE job_id = $1 AND status = 'processing'", [jobId]);
      await this.db.query("UPDATE jobs SET status = 'processing', started_at = COALESCE(started_at, $1) WHERE id = $2", [nowMs(), jobId]);
      job = await getJob(this.db, jobId) ?? null;
    }
    if (!job) return;
    await this.processJob(job);
  }

  /** Drain any queued work not represented in Redis (for recovery and tests). */
  async drainOnce(): Promise<void> {
    const job = await claimNextJob(this.db);
    if (job) await this.processJob(job);
  }

  private async processJob(job: JobRow): Promise<void> {
    if (job.status !== 'processing') return;
    const files = await getJobFiles(this.db, job.id);
    const options = job.options ?? {};
    const controller = new AbortController();
    this.aborters.set(job.id, controller);
    const deadline = (job.started_at ?? nowMs()) + this.config.jobTimeoutMs;
    let outputBytesTotal = 0;

    this.log('info', 'job started', { jobId: job.id, files: files.length, target: job.target });

    try {
      for (const file of files) {
        if (file.status === 'success' || file.status === 'failed' || file.status === 'cancelled' || file.status === 'expired') continue;
        if (controller.signal.aborted || (await isCancelRequested(this.db, job.id))) break;
        if (nowMs() > deadline) {
          await this.markFileTimedOut(file.id);
          continue;
        }
        outputBytesTotal += await this.processFile(job, file, options, controller, deadline);
      }
    } finally {
      this.aborters.delete(job.id);
    }

    if (controller.signal.aborted || (await isCancelRequested(this.db, job.id))) {
      await markCancelled(this.db, job.id);
      this.log('info', 'job cancelled', { jobId: job.id });
      return;
    }

    await recalculateJob(this.db, job.id);
    const finished = await getJob(this.db, job.id);
    if (finished?.status === 'processing' || finished?.status === 'queued') {
      await updateJobStatus(this.db, job.id, 'failed', { error: '任务未能在限定时间内完成', finished: true });
      await recalculateJob(this.db, job.id);
    }
    if (outputBytesTotal > 0) await addOutputUsage(this.db, job.user_id, outputBytesTotal);
    this.log('info', 'job finished', { jobId: job.id, status: (await getJob(this.db, job.id))?.status, outputBytesTotal });
  }

  private async markFileTimedOut(fileId: string): Promise<void> {
    await updateFileStatus(this.db, fileId, 'failed', { error: '任务超时，已终止' });
  }

  private async processFile(
    job: JobRow,
    file: JobFileRow,
    options: ConversionOptions,
    controller: AbortController,
    deadline: number,
  ): Promise<number> {
    const startedAt = nowMs();
    await updateFileStatus(this.db, file.id, 'processing', { progress: 1 });

    const workDir = join(this.config.tmpDir, job.id, file.id);
    const outputDir = join(this.config.outputsDir, job.id);
    await mkdir(workDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });

    let lastWrite = 0;
    const timeoutMs = Math.max(5_000, Math.min(this.config.jobTimeoutMs, deadline - startedAt));

    try {
      const outcome = await runConversion(
        {
          inputPath: file.source_path,
          outputDir,
          outputBase: file.id,
          sourceExt: file.source_ext,
          sourceKind: kindOf(file.source_ext),
          target: job.target,
          options,
          workDir,
          timeoutMs,
          signal: controller.signal,
          onProgress: (progress) => {
            const now = nowMs();
            if (now - lastWrite < 350 && progress < 99) return;
            lastWrite = now;
            void updateFileProgress(this.db, file.id, progress).catch(() => {});
          },
        },
        { bins: this.config.bins },
      );

      const info = await stat(outcome.outputPath);
      const durationMs = nowMs() - startedAt;
      await updateFileStatus(this.db, file.id, 'success', {
        progress: 100,
        outputExt: outcome.outputExt,
        outputPath: outcome.outputPath,
        outputSize: info.size,
        error: outcome.note ? outcome.note : null,
        durationMs,
      });
      this.log('info', 'file converted', { jobId: job.id, fileId: file.id, durationMs, bytes: info.size, note: outcome.note });
      return info.size;
    } catch (error) {
      const cancelled = controller.signal.aborted || (await isCancelRequested(this.db, job.id));
      const message = cancelled ? '任务已取消' : friendlyCommandError(error);
      await updateFileStatus(this.db, file.id, cancelled ? 'cancelled' : 'failed', {
        error: message,
        durationMs: nowMs() - startedAt,
      });
      this.log(cancelled ? 'info' : 'warn', cancelled ? 'file cancelled' : 'file failed', {
        jobId: job.id,
        fileId: file.id,
        error: describe(error),
      });
      return 0;
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function kindOf(ext: string): 'image' | 'document' | 'audio' | 'video' | 'pdf' {
  if (['png', 'jpg', 'webp', 'gif', 'bmp', 'tiff', 'heic'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'].includes(ext)) return 'audio';
  if (['mp4', 'mov', 'mkv', 'webm'].includes(ext)) return 'video';
  return 'document';
}

function describe(error: unknown): string {
  if (error instanceof ConversionError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
