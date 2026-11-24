import { loadConfig } from './config.ts';
import { createDb } from './db/db.ts';
import { prepareApplication } from './bootstrap.ts';
import { createLogger } from './logger.ts';
import { WorkerPool } from './jobs/worker.ts';
import { startCleanupScheduler } from './jobs/cleanup.ts';
import { createAppServer } from './http/server.ts';

const config = loadConfig();
const log = createLogger('web');
const db = createDb(config.databaseUrl, config.databasePoolSize, config.databaseSsl);
const pool = new WorkerPool({ config, db, log });

let stopping = false;

async function main(): Promise<void> {
  await prepareApplication(config, db, log);
  await pool.start();
  const cleanup = startCleanupScheduler(config, db, log);

  if (config.processRole === 'worker') {
    log.info('worker process started');
    const keepAlive = setInterval(() => {}, 60_000);
    const stop = async (signal: string) => {
      if (stopping) return;
      stopping = true;
      log.info('worker shutting down', { signal });
      clearInterval(keepAlive);
      cleanup.stop();
      await pool.stop();
      await db.close();
      process.exit(0);
    };
    process.on('SIGINT', () => void stop('SIGINT'));
    process.on('SIGTERM', () => void stop('SIGTERM'));
    return;
  }

  const server = createAppServer(config, db, pool, log);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => resolve());
  });
  log.info('ConvertLab listening', { url: config.baseUrl, port: config.port, role: config.processRole });

  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info('server shutting down', { signal });
    cleanup.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.stop();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));
}

process.on('unhandledRejection', (reason) => {
  log.error('unhandled promise rejection', { error: reason instanceof Error ? reason.stack : String(reason) });
});

main().catch((error) => {
  log.error('startup failed', { error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
  process.exit(1);
});
