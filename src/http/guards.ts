import { Errors } from './errors.ts';
import { SESSION_COOKIE, revokeSession } from '../auth/session.ts';
import { serializeCookie } from './http.ts';
import type { RequestContext } from './types.ts';

export function requireUser(ctx: RequestContext) {
  if (!ctx.auth) throw Errors.unauthorized();
  return ctx.auth;
}

export function requireAdmin(ctx: RequestContext) {
  const user = requireUser(ctx);
  if (user.role !== 'admin') throw Errors.forbidden('需要管理员权限');
  return user;
}

export function requireCsrf(ctx: RequestContext): void {
  const expected = ctx.auth?.csrf;
  const supplied = ctx.req.headers['x-csrf-token'];
  const value = Array.isArray(supplied) ? supplied[0] : supplied;
  if (!expected || !value || value !== expected) {
    throw Errors.forbidden('安全校验失败，请刷新页面后重试');
  }
}

export function sessionCookie(ctx: RequestContext, token: string, maxAgeSeconds: number): string {
  return serializeCookie(SESSION_COOKIE, token, {
    maxAgeSeconds,
    secure: ctx.config.secureCookies,
    httpOnly: true,
    sameSite: 'Lax',
  });
}

export function clearedSessionCookie(ctx: RequestContext): string {
  return serializeCookie(SESSION_COOKIE, '', {
    maxAgeSeconds: 0,
    secure: ctx.config.secureCookies,
    httpOnly: true,
    sameSite: 'Lax',
  });
}

export async function logout(ctx: RequestContext): Promise<void> {
  if (ctx.auth) await revokeSession(ctx.db, ctx.auth.sessionId);
  ctx.res.setHeader('Set-Cookie', clearedSessionCookie(ctx));
}
