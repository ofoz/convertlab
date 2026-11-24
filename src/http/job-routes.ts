import { createReadStream } from 'node:fs';
import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ZipFile } from 'yazl';
import type { Router } from './router.ts';
import type { RequestContext } from './types.ts';
import { AppError, Errors } from './errors.ts';
import { contentDisposition, sendJson } from './http.ts';
import { requireCsrf, requireUser } from './guards.ts';
import { formatKindForUpload, normalizeTarget, parseOptions, safeFilename } from './validation.ts';
import { FORMATS, validateConversion, type FormatExt } from '../converters/formats.ts';
import { mimeFor } from '../converters/formats.ts';
import { sniffFile, sniffZipContainer } from '../converters/sniff.ts';
import { cleanup, readMultipart, type UploadedFile } from './multipart.ts';
import { addJobUsage, getUsage } from '../db/repos/usage.ts';
import { num } from '../db/db.ts';
import { writeAudit } from '../db/repos/audit.ts';
import {
  createJob,
  getJob,
  getJobFile,
  getJobFiles,
  listJobs,
  markCancelled,
  requestCancel,
  type JobRow,
} from '../jobs/store.ts';
import { publicFile, publicJob } from '../jobs/serialize.ts';

const TERMINAL = new Set(['success', 'partial', 'failed', 'cancelled']);

async function ownedJob(ctx: RequestContext, jobId: string): Promise<JobRow> {
  const user = requireUser(ctx);
  const job = await getJob(ctx.db, jobId);
  if (!job) throw Errors.notFound('任务不存在');
  if (job.user_id !== user.id && user.role !== 'admin') throw Errors.notFound('任务不存在');
  return job;
}

function outputName(name: string, ext: string | null): string {
  const original = safeFilename(name);
  const current = extname(original);
  const stem = current ? original.slice(0, -current.length) : original;
  return `${stem || 'converted'}${ext ? `.${ext}` : ''}`;
}

function uniqueName(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  const ext = extname(base);
  const stem = base.slice(0, base.length - ext.length);
  let index = 2;
  let candidate = `${stem} (${index})${ext}`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `${stem} (${index})${ext}`;
  }
  used.add(candidate);
  return candidate;
}

export function registerJobRoutes(router: Router): void {
  router.get('/api/jobs', async (ctx) => {
    const user = requireUser(ctx);
    const limit = Math.min(100, Math.max(1, Number.parseInt(ctx.url.searchParams.get('limit') ?? '20', 10) || 20));
    const offset = Math.max(0, Number.parseInt(ctx.url.searchParams.get('offset') ?? '0', 10) || 0);
    const { rows, total } = await listJobs(ctx.db, user.id, { limit, offset });
    const items = await Promise.all(
      rows.map(async (job) => publicJob(job, await getJobFiles(ctx.db, job.id))),
    );
    sendJson(ctx.res, 200, { jobs: items, total, limit, offset });
  });

  router.get('/api/jobs/:id', async (ctx) => {
    const job = await ownedJob(ctx, ctx.params.id!);
    sendJson(ctx.res, 200, { job: publicJob(job, await getJobFiles(ctx.db, job.id)) });
  });

  router.post('/api/jobs', async (ctx) => {
    const user = requireUser(ctx);
    requireCsrf(ctx);
    await mkdir(ctx.config.tmpDir, { recursive: true });
    const uploadDir = join(ctx.config.tmpDir, `upload-${randomUUID()}`);
    await mkdir(uploadDir, { recursive: true, mode: 0o700 });

    let uploads: UploadedFile[] = [];
    const moved: string[] = [];
    try {
      const form = await readMultipart(ctx.req, {
        dir: uploadDir,
        maxFiles: ctx.config.maxBatchFiles,
        maxFileBytes: ctx.config.maxFileBytes,
      });
      uploads = form.files;
      const target = normalizeTarget(form.fields.target);
      let optionsRaw: unknown = {};
      if (form.fields.options) {
        try {
          optionsRaw = JSON.parse(form.fields.options);
        } catch {
          throw Errors.badRequest('转换参数格式无效');
        }
      }
      const options = parseOptions(optionsRaw, target);

      const totalBytes = uploads.reduce((sum, file) => sum + file.size, 0);
      if (uploads.length > ctx.config.maxBatchFiles) throw Errors.badRequest(`一次最多上传 ${ctx.config.maxBatchFiles} 个文件`);
      for (const file of uploads) {
        if (file.size <= 0) throw Errors.badRequest(`文件 ${file.filename} 为空`);
        if (file.size > ctx.config.maxFileBytes) {
          throw Errors.tooLarge(`文件 ${file.filename} 超过 ${Math.round(ctx.config.maxFileBytes / 1024 / 1024)} MB`);
        }
      }

      const usage = await getUsage(ctx.db, user.id);
      const jobLimit = user.quotaJobs ?? ctx.config.dailyJobs;
      const uploadLimit = user.quotaUploadBytes ?? ctx.config.dailyUploadBytes;
      if (usage.jobs >= jobLimit) throw Errors.quota(`今日任务次数已达上限（${jobLimit} 次）`, { jobs: usage.jobs, limit: jobLimit });
      if (usage.upload_bytes + totalBytes > uploadLimit) {
        throw Errors.quota(`今日上传流量不足（已用 ${formatBytes(usage.upload_bytes)}，上限 ${formatBytes(uploadLimit)}）`);
      }

      const prepared: Array<{ file: UploadedFile; ext: string; kind: ReturnType<typeof formatKindForUpload>; dest: string }> = [];
      const invalid: Array<{ name: string; reason: string }> = [];
      for (const file of uploads) {
        const ext = extname(file.filename).slice(1).toLowerCase();
        try {
          let sniff = await sniffFile(file.path);
          if (sniff.kind === 'archive') {
            const deep = await sniffZipContainer(file.path);
            if (deep) sniff = { ext: deep, kind: 'document' };
            else throw Errors.unsupported('压缩包不能直接转换');
          }
          const kind = formatKindForUpload(ext, sniff.kind);
          const plan = validateConversion({ ext, kind, originalName: file.filename }, target);
          if (!plan.allowed) throw Errors.unsupported(plan.reason);
          const dest = join(ctx.config.uploadsDir, `${randomUUID()}.${ext}`);
          prepared.push({ file, ext, kind, dest });
        } catch (error) {
          invalid.push({ name: file.filename, reason: error instanceof Error ? error.message : '无法识别文件' });
        }
      }
      if (invalid.length > 0) {
        throw Errors.badRequest('部分文件无法转换，请移除后重试', invalid);
      }

      await mkdir(ctx.config.uploadsDir, { recursive: true });
      for (const item of prepared) {
        try {
          await rename(item.file.path, item.dest);
        } catch {
          await copyFile(item.file.path, item.dest);
          await rm(item.file.path, { force: true });
        }
        moved.push(item.dest);
      }

      const created = await createJob(ctx.db, {
        userId: user.id,
        target,
        options,
        ttlMs: ctx.config.fileTtlHours * 60 * 60 * 1000,
        files: prepared.map((item) => ({
          originalName: item.file.filename,
          sourceExt: item.ext,
          sourceMime: (FORMATS[item.ext as FormatExt] as { mimes: readonly string[] }).mimes[0] ?? item.file.mime,
          sourceSize: item.file.size,
          sourcePath: item.dest,
        })),
      });
      await addJobUsage(ctx.db, user.id, totalBytes);
      try {
        await ctx.pool.enqueue(created.job.id);
      } catch (error) {
        ctx.log('error', 'enqueue failed', { jobId: created.job.id, error: error instanceof Error ? error.message : String(error) });
        throw Errors.internal('任务已保存，但队列暂时不可用，请稍后重试');
      }
      await writeAudit(ctx.db, {
        actorId: user.id,
        action: 'job.create',
        targetType: 'job',
        targetId: created.job.id,
        detail: { target, files: uploads.length, bytes: totalBytes },
        ip: ctx.ip,
      });
      sendJson(ctx.res, 202, { job: publicJob(created.job, created.files), usage: await getUsage(ctx.db, user.id) });
    } catch (error) {
      await cleanup(uploads);
      if (moved.length > 0) await Promise.all(moved.map((path) => rm(path, { force: true }).catch(() => {})));
      throw error;
    } finally {
      await rm(uploadDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  router.delete('/api/jobs/:id', async (ctx) => {
    const user = requireUser(ctx);
    requireCsrf(ctx);
    const job = await ownedJob(ctx, ctx.params.id!);
    if (TERMINAL.has(job.status)) throw Errors.conflict('任务已结束，无法取消');
    await requestCancel(ctx.db, job.id);
    ctx.pool.cancel(job.id);
    await markCancelled(ctx.db, job.id);
    await writeAudit(ctx.db, { actorId: user.id, action: 'job.cancel', targetType: 'job', targetId: job.id, ip: ctx.ip });
    const updated = await getJob(ctx.db, job.id);
    sendJson(ctx.res, 200, { job: updated ? publicJob(updated, await getJobFiles(ctx.db, job.id)) : null });
  });

  router.get('/api/jobs/:id/events', async (ctx) => {
    const job = await ownedJob(ctx, ctx.params.id!);
    ctx.res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    let closed = false;
    let last = '';
    const send = async () => {
      if (closed) return;
      const current = await getJob(ctx.db, job.id);
      if (!current) return;
      const payload = publicJob(current, await getJobFiles(ctx.db, job.id));
      const serialized = JSON.stringify(payload);
      if (serialized !== last) {
        last = serialized;
        ctx.res.write(`event: update\ndata: ${serialized}\n\n`);
      } else {
        ctx.res.write(': keepalive\n\n');
      }
      if (TERMINAL.has(current.status)) {
        ctx.res.write('event: done\ndata: {}\n\n');
        closed = true;
        clearInterval(timer);
        ctx.res.end();
      }
    };
    const timer = setInterval(() => {
      void send().catch(() => {
        clearInterval(timer);
        ctx.res.end();
      });
    }, 800);
    ctx.req.on('close', () => {
      closed = true;
      clearInterval(timer);
    });
    await send();
  });

  router.get('/api/jobs/:id/files/:fileId/download', async (ctx) => {
    const job = await ownedJob(ctx, ctx.params.id!);
    const file = await getJobFile(ctx.db, ctx.params.fileId!);
    if (!file || file.job_id !== job.id) throw Errors.notFound('文件不存在');
    if (!file.output_path || !['success'].includes(file.status)) {
      throw new AppError(410, 'GONE', '结果文件不可用或已过期清理');
    }
    const info = await stat(file.output_path).catch(() => null);
    if (!info) throw new AppError(410, 'GONE', '结果文件已被清理');
    const name = outputName(file.original_name, file.output_ext);
    ctx.res.writeHead(200, {
      'Content-Type': mimeFor(file.output_ext ?? ''),
      'Content-Length': String(info.size),
      'Content-Disposition': contentDisposition(name),
      'Cache-Control': 'private, no-store',
    });
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(file.output_path!);
      stream.on('error', reject);
      ctx.res.on('close', resolve);
      ctx.res.on('finish', resolve);
      stream.pipe(ctx.res);
    });
  });

  router.get('/api/jobs/:id/download', async (ctx) => {
    const job = await ownedJob(ctx, ctx.params.id!);
    const files = (await getJobFiles(ctx.db, job.id)).filter((file) => file.status === 'success' && file.output_path);
    if (files.length === 0) throw Errors.notFound('没有可下载的结果文件');
    const exports = [];
    for (const file of files) {
      const info = await stat(file.output_path!).catch(() => null);
      if (info?.isFile()) exports.push({ file, info });
    }
    if (exports.length === 0) throw new AppError(410, 'GONE', '结果文件已过期清理');

    const zipName = `ConvertLab-${new Date(job.created_at).toISOString().slice(0, 10)}-${job.id.slice(0, 8)}.zip`;
    ctx.res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': contentDisposition(zipName),
      'Cache-Control': 'private, no-store',
    });
    const zip = new ZipFile();
    const used = new Set<string>();
    for (const { file } of exports) {
      zip.addFile(file.output_path!, uniqueName(outputName(file.original_name, file.output_ext), used));
    }
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        ctx.log('error', 'zip stream failed', { jobId: job.id, error: error.message });
        ctx.res.destroy(error);
        reject(error);
      };
      zip.outputStream.once('error', fail);
      zip.outputStream.once('end', done);
      ctx.res.once('close', done);
      zip.outputStream.pipe(ctx.res);
      zip.end();
    });
  });
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}
