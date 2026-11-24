import type { Router } from './router.ts';
import type { RequestContext } from './types.ts';
import { AppError, Errors } from './errors.ts';
import { readJson, sendJson } from './http.ts';
import { normalizeEmail, requireString } from './validation.ts';
import { hashPassword, validatePasswordStrength, verifyPassword } from '../auth/password.ts';
import { createSession, revokeAllSessions } from '../auth/session.ts';
import { createUser, findByEmail, findById, toPublicUser, touchLogin, updatePassword } from '../db/repos/users.ts';
import { writeAudit } from '../db/repos/audit.ts';
import { getQuotaSnapshot } from '../db/repos/usage.ts';
import { limiters } from '../auth/ratelimit.ts';
import { requireCsrf, requireUser, sessionCookie, logout } from './guards.ts';
import { isRegistrationOpen } from '../db/settings.ts';

function rateLimit(ctx: RequestContext, bucket: 'login' | 'register' | 'password', key: string, limit: number): void {
  const result = limiters[bucket].hit(`${key}:${ctx.ip}`, limit);
  if (!result.allowed) {
    ctx.res.setHeader('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
    throw Errors.quota('操作过于频繁，请稍后重试');
  }
}

async function userPayload(ctx: RequestContext) {
  const user = requireUser(ctx);
  const row = await findById(ctx.db, user.id);
  if (!row) throw Errors.unauthorized();
  const usage = await getQuotaSnapshot(ctx.db, user.id);
  return {
    user: toPublicUser(row),
    csrf: user.csrf,
    usage,
    quotas: {
      jobs: user.quotaJobs ?? ctx.config.dailyJobs,
      uploadBytes: user.quotaUploadBytes ?? ctx.config.dailyUploadBytes,
      outputBytes: user.quotaOutputBytes ?? ctx.config.dailyOutputBytes,
    },
  };
}

export function registerAuthRoutes(router: Router): void {
  router.get('/api/auth/me', async (ctx) => {
    if (!ctx.auth) {
      sendJson(ctx.res, 200, { user: null, registrationOpen: await isRegistrationOpen(ctx.db, ctx.config.allowRegistration) });
      return;
    }
    sendJson(ctx.res, 200, { ...(await userPayload(ctx)), registrationOpen: await isRegistrationOpen(ctx.db, ctx.config.allowRegistration) });
  });

  router.post('/api/auth/register', async (ctx) => {
    if (!(await isRegistrationOpen(ctx.db, ctx.config.allowRegistration))) throw Errors.forbidden('当前未开放注册，请联系管理员');
    rateLimit(ctx, 'register', 'register', 10);
    const body = (await readJson(ctx.req)) as Record<string, unknown>;
    const email = normalizeEmail(body.email);
    const password = requireString(body.password, '密码', 200);
    const strength = validatePasswordStrength(password);
    if (strength) throw Errors.badRequest(strength);
    if (await findByEmail(ctx.db, email)) throw Errors.conflict('该邮箱已注册');

    const passwordHash = await hashPassword(password);
    let user;
    try {
      user = await createUser(ctx.db, { email, passwordHash });
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && (error as { code?: string }).code === '23505') {
        throw Errors.conflict('该邮箱已注册');
      }
      throw error;
    }
    const session = await createSession(ctx.db, user.id, ctx.config.sessionTtlDays, {
      ip: ctx.ip,
      userAgent: String(ctx.req.headers['user-agent'] ?? ''),
    });
    ctx.res.setHeader('Set-Cookie', sessionCookie(ctx, session.token, ctx.config.sessionTtlDays * 86400));
    await writeAudit(ctx.db, { actorId: user.id, action: 'auth.register', targetType: 'user', targetId: user.id, ip: ctx.ip });
    sendJson(ctx.res, 201, {
      user: toPublicUser(user),
      csrf: session.csrf,
      usage: { jobs: 0, uploadBytes: 0, outputBytes: 0 },
      quotas: { jobs: ctx.config.dailyJobs, uploadBytes: ctx.config.dailyUploadBytes, outputBytes: ctx.config.dailyOutputBytes },
    });
  });

  router.post('/api/auth/login', async (ctx) => {
    rateLimit(ctx, 'login', 'login', 12);
    const body = (await readJson(ctx.req)) as Record<string, unknown>;
    const email = normalizeEmail(body.email);
    const password = requireString(body.password, '密码', 200);
    const emailLimit = limiters.login.hit(`email:${email}`, 10);
    if (!emailLimit.allowed) throw Errors.quota('登录尝试过于频繁，请稍后再试');

    const user = await findByEmail(ctx.db, email);
    const ok = user ? await verifyPassword(password, user.password_hash) : false;
    if (!user || !ok) {
      await writeAudit(ctx.db, { actorId: null, action: 'auth.login_failed', targetType: 'email', targetId: email, ip: ctx.ip });
      throw new AppError(401, 'INVALID_CREDENTIALS', '邮箱或密码不正确');
    }
    if (user.status !== 'active') throw Errors.forbidden(user.disabled_reason || '账号已被停用');
    await touchLogin(ctx.db, user.id);
    const session = await createSession(ctx.db, user.id, ctx.config.sessionTtlDays, {
      ip: ctx.ip,
      userAgent: String(ctx.req.headers['user-agent'] ?? ''),
    });
    ctx.res.setHeader('Set-Cookie', sessionCookie(ctx, session.token, ctx.config.sessionTtlDays * 86400));
    limiters.login.reset(`email:${email}`);
    await writeAudit(ctx.db, { actorId: user.id, action: 'auth.login', targetType: 'user', targetId: user.id, ip: ctx.ip });
    sendJson(ctx.res, 200, {
      user: toPublicUser(user),
      csrf: session.csrf,
      usage: await getQuotaSnapshot(ctx.db, user.id),
      quotas: {
        jobs: user.quota_jobs ?? ctx.config.dailyJobs,
        uploadBytes: user.quota_upload_bytes ?? ctx.config.dailyUploadBytes,
        outputBytes: user.quota_output_bytes ?? ctx.config.dailyOutputBytes,
      },
    });
  });

  router.post('/api/auth/logout', async (ctx) => {
    requireUser(ctx);
    requireCsrf(ctx);
    await logout(ctx);
    sendJson(ctx.res, 200, { ok: true });
  });

  router.post('/api/auth/password', async (ctx) => {
    const user = requireUser(ctx);
    requireCsrf(ctx);
    rateLimit(ctx, 'password', `password:${user.id}`, 8);
    const body = (await readJson(ctx.req)) as Record<string, unknown>;
    const current = requireString(body.currentPassword, '当前密码', 200);
    const next = requireString(body.newPassword, '新密码', 200);
    const strength = validatePasswordStrength(next);
    if (strength) throw Errors.badRequest(strength);
    const row = await findById(ctx.db, user.id);
    if (!row || !(await verifyPassword(current, row.password_hash))) throw Errors.badRequest('当前密码不正确');
    await updatePassword(ctx.db, user.id, await hashPassword(next));
    const revoked = await revokeAllSessions(ctx.db, user.id, user.sessionId);
    await writeAudit(ctx.db, { actorId: user.id, action: 'auth.password_changed', targetType: 'user', targetId: user.id, detail: { revoked }, ip: ctx.ip });
    sendJson(ctx.res, 200, { ok: true, revokedSessions: revoked });
  });

  router.get('/api/account/usage', async (ctx) => {
    requireUser(ctx);
    sendJson(ctx.res, 200, await userPayload(ctx));
  });
}
