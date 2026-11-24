import type { Router } from './router.ts';
import { sendJson } from './http.ts';
import { FORMATS, FORMAT_CATALOG, targetsFor, type FormatExt } from '../converters/formats.ts';
import { isRegistrationOpen } from '../db/settings.ts';

export function registerPublicRoutes(router: Router): void {
  router.get('/api/formats', async (ctx) => {
    const formats = (Object.entries(FORMATS) as Array<[FormatExt, (typeof FORMATS)[FormatExt]]>)
      .filter(([, format]) => format.kind !== 'archive')
      .map(([ext, format]) => ({
        ext,
        label: format.label,
        kind: format.kind,
        targets: targetsFor(ext, format.kind),
      }));
    sendJson(ctx.res, 200, {
      formats,
      catalog: FORMAT_CATALOG,
      limits: {
        maxFileBytes: ctx.config.maxFileBytes,
        maxFileMb: Math.round(ctx.config.maxFileBytes / 1024 / 1024),
        maxBatchFiles: ctx.config.maxBatchFiles,
        dailyJobs: ctx.config.dailyJobs,
        dailyUploadBytes: ctx.config.dailyUploadBytes,
        dailyOutputBytes: ctx.config.dailyOutputBytes,
        fileTtlHours: ctx.config.fileTtlHours,
      },
      registrationOpen: await isRegistrationOpen(ctx.db, ctx.config.allowRegistration),
    });
  });

  router.get('/api/health', async (ctx) => {
    let database = false;
    try {
      await ctx.db.query('SELECT 1');
      database = true;
    } catch {}
    let redis = false;
    try {
      redis = await ctx.pool.ping();
    } catch {}
    const ok = database && redis;
    sendJson(ctx.res, ok ? 200 : 503, {
      status: ok ? 'ok' : 'degraded',
      database,
      redis,
      role: ctx.config.processRole,
      version: process.env.npm_package_version ?? '1.0.0',
      uptimeSeconds: Math.round(process.uptime()),
      now: new Date().toISOString(),
    });
  });
}
