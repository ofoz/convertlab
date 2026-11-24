import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppConfig } from '../config.ts';
import type { Db } from '../db/db.ts';
import type { WorkerPool } from '../jobs/worker.ts';
import type { SessionUser } from '../auth/session.ts';

export type RequestContext = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  config: AppConfig;
  db: Db;
  pool: WorkerPool;
  requestId: string;
  auth: SessionUser | null;
  ip: string;
  log: (level: 'info' | 'warn' | 'error', message: string, detail?: unknown) => void;
};

export type RouteHandler = (ctx: RequestContext) => Promise<void> | void;
