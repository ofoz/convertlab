import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

function envStr(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, received "${raw}"`);
  }
  return Math.min(max, Math.max(min, parsed));
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return /^(1|true|yes|on)$/i.test(raw);
}

export type AppConfig = {
  env: string;
  host: string;
  port: number;
  baseUrl: string;
  trustProxy: boolean;
  dataDir: string;
  publicDir: string;
  uploadsDir: string;
  outputsDir: string;
  tmpDir: string;
  adminEmail: string;
  adminPassword: string;
  sessionTtlDays: number;
  allowRegistration: boolean;
  fileTtlHours: number;
  maxFileBytes: number;
  maxBatchFiles: number;
  dailyJobs: number;
  dailyUploadBytes: number;
  dailyOutputBytes: number;
  workerConcurrency: number;
  jobTimeoutMs: number;
  secureCookies: boolean;
  processRole: 'all' | 'web' | 'worker';
  databaseUrl: string;
  databaseSsl: boolean;
  redisUrl: string;
  queueName: string;
  databasePoolSize: number;
  sessionSecret: string;
  bins: {
    soffice: string;
    ffmpeg: string;
    ffprobe: string;
    gs: string;
    pdftoppm: string;
    pdftotext: string;
    pdftocairo: string;
    pdfinfo: string;
    ocrmypdf: string;
    tesseract: string;
  };
};

export function loadConfig(): AppConfig {
  const dataDir = resolve(envStr('DATA_DIR', './data'));
  const maxFileMb = envInt('MAX_FILE_MB', 100, 1, 2048);
  const baseUrl = envStr('APP_BASE_URL', 'http://localhost:8080').replace(/\/+$/, '');
  const databaseUrl = envStr('DATABASE_URL', '');
  return {
    env: envStr('NODE_ENV', 'development'),
    host: envStr('HOST', '0.0.0.0'),
    port: envInt('PORT', 8080, 1, 65535),
    baseUrl,
    trustProxy: envBool('TRUST_PROXY', true),
    dataDir,
    publicDir: resolve(envStr('PUBLIC_DIR', './dist/web')),
    uploadsDir: join(dataDir, 'uploads'),
    outputsDir: join(dataDir, 'outputs'),
    tmpDir: join(dataDir, 'tmp'),
    adminEmail: envStr('ADMIN_EMAIL', 'admin@example.com').trim().toLowerCase(),
    adminPassword: envStr('ADMIN_PASSWORD', ''),
    sessionTtlDays: envInt('SESSION_TTL_DAYS', 30, 1, 365),
    allowRegistration: envBool('ALLOW_REGISTRATION', true),
    fileTtlHours: envInt('FILE_TTL_HOURS', 2, 1, 168),
    maxFileBytes: maxFileMb * 1024 * 1024,
    maxBatchFiles: envInt('MAX_BATCH_FILES', 20, 1, 50),
    dailyJobs: envInt('DAILY_JOBS', 20, 1, 10000),
    dailyUploadBytes: envInt('DAILY_UPLOAD_MB', 1024, 1, 1024 * 100) * 1024 * 1024,
    dailyOutputBytes: envInt('DAILY_OUTPUT_MB', 2048, 1, 1024 * 100) * 1024 * 1024,
    workerConcurrency: envInt('WORKER_CONCURRENCY', 3, 1, 16),
    jobTimeoutMs: envInt('JOB_TIMEOUT_SEC', 600, 10, 7200) * 1000,
    secureCookies: envBool('SECURE_COOKIES', baseUrl.startsWith('https://')),
    processRole: (envStr('PROCESS_ROLE', 'all') as AppConfig['processRole']),
    databaseUrl,
    // Set DATABASE_SSL=true for managed PostgreSQL (Supabase, Neon, RDS) whose
    // connection string does not already contain sslmode=require.
    databaseSsl: envBool('DATABASE_SSL', false),
    redisUrl: envStr('REDIS_URL', 'redis://127.0.0.1:6379'),
    queueName: envStr('QUEUE_NAME', 'convertlab'),
    databasePoolSize: envInt('DATABASE_POOL_SIZE', 10, 2, 50),
    // Sessions are bearer tokens stored as SHA-256 hashes; this value is only used
    // for signing auxiliary cookies. A generated value is stable for the container
    // lifetime. Set COOKIE_SECRET explicitly if you run several web replicas.
    sessionSecret: envStr('COOKIE_SECRET', createHash('sha256').update(`convertlab:${baseUrl}:${dataDir}`).digest('hex')),
    bins: {
      soffice: envStr('SOFFICE_PATH', 'soffice'),
      ffmpeg: envStr('FFMPEG_PATH', 'ffmpeg'),
      ffprobe: envStr('FFPROBE_PATH', 'ffprobe'),
      gs: envStr('GS_PATH', 'gs'),
      pdftoppm: envStr('PDFTOPPM_PATH', 'pdftoppm'),
      pdftotext: envStr('PDFTOTEXT_PATH', 'pdftotext'),
      pdftocairo: envStr('PDFTOCAIRO_PATH', 'pdftocairo'),
      pdfinfo: envStr('PDFINFO_PATH', 'pdfinfo'),
      ocrmypdf: envStr('OCRMYPDF_PATH', 'ocrmypdf'),
      tesseract: envStr('TESSERACT_PATH', 'tesseract'),
    },
  };
}
