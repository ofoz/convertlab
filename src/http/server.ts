import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config.ts';
import type { Db } from '../db/db.ts';
import type { WorkerPool } from '../jobs/worker.ts';
import { resolveSession, SESSION_COOKIE } from '../auth/session.ts';
import { parseCookies, clientIp, sendJson } from './http.ts';
import { Router } from './router.ts';
import { AppError, errorPayload } from './errors.ts';
import type { RequestContext } from './types.ts';
import { registerAuthRoutes } from './auth-routes.ts';
import { registerJobRoutes } from './job-routes.ts';
import { registerAdminRoutes } from './admin-routes.ts';
import { registerPublicRoutes } from './public-routes.ts';
import { serveStatic } from './static.ts';

type Logger = (level: 'info' | 'warn' | 'error', message: string, detail?: unknown) => void;

function buildRouter(): Router {
  const router = new Router();
  registerPublicRoutes(router);
  registerAuthRoutes(router);
  registerJobRoutes(router);
  registerAdminRoutes(router);
  return router;
}

export function createAppServer(config: AppConfig, db: Db, pool: WorkerPool, log: Logger) {
  const router = buildRouter();

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const started = Date.now();
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    let pathname = '/';
    try {
      const url = new URL(req.url ?? '/', config.baseUrl);
      pathname = url.pathname;
      const ip = clientIp(req, config.trustProxy);

      if (!pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const served = await serveStatic(req, res, config.publicDir, pathname);
        if (!served) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end('Not found');
        }
        return;
      }

      const match = router.match(req.method ?? 'GET', pathname);
      if (!match) {
        sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '接口不存在', requestId } });
        return;
      }

      const cookies = parseCookies(req.headers.cookie);
      const auth = await resolveSession(db, cookies[SESSION_COOKIE]);

      const ctx: RequestContext = {
        req,
        res,
        url,
        params: match.params,
        config,
        db,
        pool,
        requestId,
        auth,
        ip,
        log,
      };
      await match.handler(ctx);
    } catch (error) {
      if (res.writableEnded) return;
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error instanceof AppError) {
        if (error.status >= 500) log('error', 'request failed', { requestId, path: pathname, error: error.message });
        sendJson(res, error.status, errorPayload(error, requestId));
      } else {
        log('error', 'unhandled request error', {
          requestId,
          path: pathname,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        sendJson(res, 500, errorPayload(new AppError(500, 'INTERNAL_ERROR', '服务器暂时无法完成操作'), requestId));
      }
    } finally {
      if (pathname.startsWith('/api/')) {
        const elapsed = Date.now() - started;
        if (elapsed > 2000) log('warn', 'slow request', { method: req.method, path: pathname, status: res.statusCode, elapsed });
      }
    }
  });

  server.requestTimeout = 0;
  server.headersTimeout = 65_000;
  server.keepAliveTimeout = 61_000;
  return server;
}
