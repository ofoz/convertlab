import { rm } from 'node:fs/promises';
import type { Router } from './router.ts';
import type { RequestContext } from './types.ts';
import { AppError, Errors } from './errors.ts';
import { readJson, sendJson } from './http.ts';
import { normalizeEmail, optionalInt, requireString } from './validation.ts';
import { requireAdmin, requireCsrf } from './guards.ts';
import { hashPassword, validatePasswordStrength } from '../auth/password.ts';
import { revokeAllSessions } from '../auth/session.ts';
import {
  countActiveAdmins,
  countUsers,
  createUser,
  findById,
  listUsers,
  setQuotas,
  setStatus,
  toPublicUser,
  updatePassword,
} from '../db/repos/users.ts';
import { listAudit, writeAudit } from '../db/repos/audit.ts';
import { getQuotaSnapshot, usageTotals } from '../db/repos/usage.ts';
import { getSetting, setSetting } from '../db/settings.ts';
import { num } from '../db/db.ts';
import {
  getJob,
  getJobFiles,
  jobStats,
  listAllJobs,
  listJobs,
  markCancelled,
  requestCancel,
} from '../jobs/store.ts';
import { publicJob } from '../jobs/serialize.ts';
import { runCleanup } from '../jobs/cleanup.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validUserId(ctx: RequestContext): string {
  const id = ctx.params.id!;
  if (!UUID.test(id)) throw Errors.notFound('用户不存在');
  return id;
}

function pageParams(ctx: RequestContext): { limit: number; offset: number } {
  const limit = Math.min(100, Math.max(1, Number.parseInt(ctx.url.searchParams.get('limit') ?? '25', 10) || 25));
  const offset = Math.max(0, Number.parseInt(ctx.url.searchParams.get('offset') ?? '0', 10) || 0);
  return { limit, offset };
}

async function assertCanDisable(ctx: RequestContext, id: string): Promise<void> {
  const admin = requireAdmin(ctx);
  if (admin.id === id) throw Errors.conflict('不能停用自己的账号');
  const target = await findById(ctx.db, id);
  if (!target) throw Errors.notFound('用户不存在');
  if (target.role === 'admin' && (await countActiveAdmins(ctx.db)) <= 1) {
    throw Errors.conflict('至少需要保留一名可用管理员');
  }
}

export function registerAdminRoutes(router: Router): void {
  router.get('/api/admin/stats', async (ctx) => {
    requireAdmin(ctx);
    const [users, activeAdmins, jobs, usage, storage, dbSize, pending] = await Promise.all([
      countUsers(ctx.db),
      countActiveAdmins(ctx.db),
      jobStats(ctx.db),
      usageTotals(ctx.db),
      ctx.db.one(
        "SELECT COALESCE(SUM(output_size),0)::bigint AS bytes, COUNT(*)::int AS files FROM job_files WHERE status = 'success' AND expires_at > $1",
        [Date.now()],
      ),
      ctx.db.one('SELECT pg_database_size(current_database())::bigint AS bytes'),
      ctx.db.one("SELECT COUNT(*)::int AS n FROM jobs WHERE status IN ('queued','processing')"),
    ]);
    sendJson(ctx.res, 200, {
      users: { total: users, activeAdmins },
      jobs,
      usage,
      storage: { activeOutputBytes: num(storage?.bytes), activeOutputFiles: num(storage?.files), databaseBytes: num(dbSize?.bytes) },
      pending: num(pending?.n),
      limits: {
        maxFileBytes: ctx.config.maxFileBytes,
        maxBatchFiles: ctx.config.maxBatchFiles,
        dailyJobs: ctx.config.dailyJobs,
        dailyUploadBytes: ctx.config.dailyUploadBytes,
        dailyOutputBytes: ctx.config.dailyOutputBytes,
        fileTtlHours: ctx.config.fileTtlHours,
        workerConcurrency: ctx.config.workerConcurrency,
      },
    });
  });

  router.get('/api/admin/users', async (ctx) => {
    requireAdmin(ctx);
    const { limit, offset } = pageParams(ctx);
    const search = ctx.url.searchParams.get('search')?.trim() || undefined;
    const { total, rows } = await listUsers(ctx.db, { limit, offset, search });
    const enriched = await Promise.all(
      rows.map(async (row) => {
        const usage = await getQuotaSnapshot(ctx.db, row.id);
        const jobs = await ctx.db.one('SELECT COUNT(*)::int AS n FROM jobs WHERE user_id = $1', [row.id]);
        return { ...toPublicUser(row), usage, jobCount: num(jobs?.n) };
      }),
    );
    sendJson(ctx.res, 200, { users: enriched, total, limit, offset });
  });

  router.post('/api/admin/users', async (ctx) => {
    const admin = requireAdmin(ctx);
    requireCsrf(ctx);
    const body = (await readJson(ctx.req)) as Record<string, unknown>;
    const email = normalizeEmail(body.email);
    const password = requireString(body.password, '密码', 200);
    const strength = validatePasswordStrength(password);
    if (strength) throw Errors.badRequest(strength);
    const role = body.role === 'admin' ? 'admin' : 'user';
    try {
      const user = await createUser(ctx.db, { email, passwordHash: await hashPassword(password), role });
      await writeAudit(ctx.db, { actorId: admin.id, action: 'admin.user_create', targetType: 'user', targetId: user.id, detail: { email, role }, ip: ctx.ip });
      sendJson(ctx.res, 201, { user: toPublicUser(user) });
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && (error as { code?: string }).code === '23505') {
        throw Errors.conflict('该邮箱已存在');
      }
      throw error;
    }
  });

  router.patch('/api/admin/users/:id', async (ctx) => {
    const admin = requireAdmin(ctx);
    requireCsrf(ctx);
    const id = validUserId(ctx);
    const target = await findById(ctx.db, id);
    if (!target) throw Errors.notFound('用户不存在');
    const body = (await readJson(ctx.req)) as Record<string, unknown>;

    if (body.status !== undefined) {
      if (body.status !== 'active' && body.status !== 'disabled') throw Errors.badRequest('账号状态无效');
      if (body.status === 'disabled') await assertCanDisable(ctx, id);
      const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) || null : null;
      await setStatus(ctx.db, id, body.status, body.status === 'disabled' ? reason : null);
      if (body.status === 'disabled') await revokeAllSessions(ctx.db, id);
    }

    if (body.role !== undefined) {
      if (body.role !== 'user' && body.role !== 'admin') throw Errors.badRequest('角色无效');
      if (body.role === 'user' && target.role === 'admin') {
        if (admin.id === id) throw Errors.conflict('不能取消自己的管理员权限');
        if ((await countActiveAdmins(ctx.db)) <= 1) throw Errors.conflict('至少需要保留一名可用管理员');
      }
      await ctx.db.query('UPDATE users SET role = $1, updated_at = $2 WHERE id = $3', [body.role, Date.now(), id]);
    }

    if (body.quotas !== undefined && body.quotas !== null) {
      if (typeof body.quotas !== 'object' || Array.isArray(body.quotas)) throw Errors.badRequest('配额格式无效');
      const quotas = body.quotas as Record<string, unknown>;
      const jobs = optionalInt(quotas.jobs, '每日任务数', 1, 100000);
      const uploadBytes = optionalInt(quotas.uploadBytes, '每日上传字节', 1024, 1024 ** 4);
      const outputBytes = optionalInt(quotas.outputBytes, '每日输出字节', 1024, 1024 ** 4);
      await setQuotas(ctx.db, id, { jobs, uploadBytes, outputBytes });
    }

    await writeAudit(ctx.db, {
      actorId: admin.id,
      action: 'admin.user_update',
      targetType: 'user',
      targetId: id,
      detail: { status: body.status, role: body.role, quotas: body.quotas },
      ip: ctx.ip,
    });
    const updated = await findById(ctx.db, id);
    sendJson(ctx.res, 200, { user: updated ? toPublicUser(updated) : null });
  });

  router.post('/api/admin/users/:id/password', async (ctx) => {
    const admin = requireAdmin(ctx);
    requireCsrf(ctx);
    const id = validUserId(ctx);
    if (!(await findById(ctx.db, id))) throw Errors.notFound('用户不存在');
    const body = (await readJson(ctx.req)) as Record<string, unknown>;
    const password = requireString(body.password, '新密码', 200);
    const strength = validatePasswordStrength(password);
    if (strength) throw Errors.badRequest(strength);
    await updatePassword(ctx.db, id, await hashPassword(password));
    const revoked = await revokeAllSessions(ctx.db, id);
    await writeAudit(ctx.db, { actorId: admin.id, action: 'admin.password_reset', targetType: 'user', targetId: id, detail: { revoked }, ip: ctx.ip });
    sendJson(ctx.res, 200, { ok: true, revokedSessions: revoked });
  });

  router.delete('/api/admin/users/:id', async (ctx) => {
    const admin = requireAdmin(ctx);
    requireCsrf(ctx);
    const id = validUserId(ctx);
    await assertCanDisable(ctx, id);
    const paths = await ctx.db.many(
      'SELECT output_path, source_path FROM job_files f JOIN jobs j ON j.id = f.job_id WHERE j.user_id = $1',
      [id],
    );
    await ctx.db.query('DELETE FROM users WHERE id = $1', [id]);
    await Promise.all(
      paths.flatMap((row) => [row.output_path, row.source_path])
        .filter((path): path is string => typeof path === 'string' && path.length > 0)
        .map((path) => rm(path, { force: true }).catch(() => {})),
    );
    await writeAudit(ctx.db, { actorId: admin.id, action: 'admin.user_delete', targetType: 'user', targetId: id, ip: ctx.ip });
    sendJson(ctx.res, 200, { ok: true });
  });

  router.get('/api/admin/jobs', async (ctx) => {
    requireAdmin(ctx);
    const { limit, offset } = pageParams(ctx);
    const status = ctx.url.searchParams.get('status')?.trim() || undefined;
    const search = ctx.url.searchParams.get('search')?.trim() || undefined;
    const { rows, total } = await listAllJobs(ctx.db, { limit, offset, status, search });
    sendJson(ctx.res, 200, {
      jobs: rows.map((job) => ({ ...publicJob(job, []), email: job.email })),
      total,
      limit,
      offset,
    });
  });

  router.get('/api/admin/jobs/:id', async (ctx) => {
    requireAdmin(ctx);
    const job = await getJob(ctx.db, ctx.params.id!);
    if (!job) throw Errors.notFound('任务不存在');
    const owner = await findById(ctx.db, job.user_id);
    sendJson(ctx.res, 200, { job: publicJob(job, await getJobFiles(ctx.db, job.id)), email: owner?.email ?? null });
  });

  router.post('/api/admin/jobs/:id/cancel', async (ctx) => {
    const admin = requireAdmin(ctx);
    requireCsrf(ctx);
    const job = await getJob(ctx.db, ctx.params.id!);
    if (!job) throw Errors.notFound('任务不存在');
    await requestCancel(ctx.db, job.id);
    ctx.pool.cancel(job.id);
    await markCancelled(ctx.db, job.id);
    await writeAudit(ctx.db, { actorId: admin.id, action: 'admin.job_cancel', targetType: 'job', targetId: job.id, ip: ctx.ip });
    sendJson(ctx.res, 200, { ok: true });
  });

  router.get('/api/admin/audit', async (ctx) => {
    requireAdmin(ctx);
    const { limit, offset } = pageParams(ctx);
    const action = ctx.url.searchParams.get('action')?.trim() || undefined;
    sendJson(ctx.res, 200, { ...(await listAudit(ctx.db, { limit, offset, action })), limit, offset });
  });

  router.get('/api/admin/settings', async (ctx) => {
    requireAdmin(ctx);
    const registrationOpen = await getSetting<boolean>(ctx.db, 'registrationOpen');
    sendJson(ctx.res, 200, {
      registrationOpen: typeof registrationOpen === 'boolean' ? registrationOpen : ctx.config.allowRegistration,
      environment: {
        env: ctx.config.env,
        role: ctx.config.processRole,
        baseUrl: ctx.config.baseUrl,
        queue: ctx.config.queueName,
      },
    });
  });

  router.patch('/api/admin/settings', async (ctx) => {
    const admin = requireAdmin(ctx);
    requireCsrf(ctx);
    const body = (await readJson(ctx.req)) as Record<string, unknown>;
    if (body.registrationOpen !== undefined) {
      if (typeof body.registrationOpen !== 'boolean') throw Errors.badRequest('注册开关格式无效');
      await setSetting(ctx.db, 'registrationOpen', body.registrationOpen);
    }
    await writeAudit(ctx.db, { actorId: admin.id, action: 'admin.settings_update', targetType: 'settings', detail: body, ip: ctx.ip });
    sendJson(ctx.res, 200, { ok: true });
  });

  router.post('/api/admin/cleanup', async (ctx) => {
    const admin = requireAdmin(ctx);
    requireCsrf(ctx);
    const report = await runCleanup(ctx.config, ctx.db, ctx.log);
    await writeAudit(ctx.db, { actorId: admin.id, action: 'admin.cleanup', targetType: 'system', detail: report, ip: ctx.ip });
    sendJson(ctx.res, 200, { ok: true, report });
  });

  router.get('/api/admin/jobs/:id/files', async (ctx) => {
    requireAdmin(ctx);
    const job = await getJob(ctx.db, ctx.params.id!);
    if (!job) throw new AppError(404, 'NOT_FOUND', '任务不存在');
    sendJson(ctx.res, 200, { files: await getJobFiles(ctx.db, job.id) });
  });

  // Retained for code paths that need a user's own jobs from the admin context.
  router.get('/api/admin/users/:id/jobs', async (ctx) => {
    requireAdmin(ctx);
    const id = validUserId(ctx);
    const { limit, offset } = pageParams(ctx);
    const { rows, total } = await listJobs(ctx.db, id, { limit, offset });
    sendJson(ctx.res, 200, { jobs: rows.map((job) => publicJob(job, [])), total, limit, offset });
  });
}
