import { spawnSync } from 'node:child_process';
import { access, mkdir, writeFile, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { Redis } from 'ioredis';
import { loadConfig } from './config.ts';
import { createDb } from './db/db.ts';

const config = loadConfig();
const checks: Array<{ name: string; ok: boolean; detail: string; optional?: boolean }> = [];

function checkBin(name: string, bin: string, args = ['-version'], optional = false): void {
  const result = spawnSync(bin, args, { encoding: 'utf8', timeout: 15_000 });
  if (result.error || result.status !== 0) {
    const combined = `${result.stderr ?? ''}\n${result.stdout ?? ''}`;
    checks.push({
      name,
      ok: false,
      detail: `${bin} unavailable or not usable${combined.includes('libreoffice') ? ' (LibreOffice missing)' : ''}`,
      optional,
    });
    return;
  }
  const line = `${result.stdout ?? ''}`.split('\n')[0]?.slice(0, 140) ?? 'ok';
  checks.push({ name, ok: true, detail: `${bin}: ${line}`, optional });
}

checkBin('LibreOffice', config.bins.soffice, ['--version']);
checkBin('FFmpeg', config.bins.ffmpeg, ['-version']);
checkBin('FFprobe', config.bins.ffprobe, ['-version']);
checkBin('Poppler pdftoppm', config.bins.pdftoppm, ['-v']);
checkBin('Poppler pdftotext', config.bins.pdftotext, ['-v']);
checkBin('Poppler pdftocairo', config.bins.pdftocairo, ['-v']);
checkBin('Poppler pdfinfo', config.bins.pdfinfo, ['-v']);
checkBin('Ghostscript', config.bins.gs, ['--version']);
checkBin('OCRmyPDF', config.bins.ocrmypdf, ['--version']);
checkBin('Tesseract OCR', config.bins.tesseract, ['--version']);

// The Python table enhancer is optional by design.  If it disappears from a
// runtime image, PDF conversion still works through the native SVG/Poppler and
// bitmap detectors; the doctor reports a warning rather than blocking startup.
const pythonTable = spawnSync(
  process.env.PYTHON_TABLE_BIN || 'python3',
  ['-c', `
import hashlib, json
from pathlib import Path
try:
    import pdfplumber
    from rapid_table import ModelType, RapidTable, RapidTableInput
    model = RapidTable(RapidTableInput(model_type=ModelType.SLANETPLUS, use_ocr=False))
    path = Path(str(model.cfg.model_dir_or_path))
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    print(json.dumps({"pdfplumber": pdfplumber.__version__, "model": digest}))
except Exception as exc:
    print(str(exc))
    raise SystemExit(1)
`],
  { encoding: 'utf8', timeout: 20_000 },
);
if (pythonTable.error || pythonTable.status !== 0) {
  const detail = `${pythonTable.stderr || pythonTable.stdout || pythonTable.error?.message || 'Python table enhancer unavailable'}`.trim().replace(/\s+/g, ' ').slice(0, 240);
  checks.push({ name: 'Python table enhancer', ok: false, optional: true, detail });
} else {
  checks.push({ name: 'Python table enhancer', ok: true, optional: true, detail: (pythonTable.stdout || '').trim() });
}

if (config.databaseUrl) {
  const db = createDb(config.databaseUrl, 2, config.databaseSsl);
  try {
    await db.query('SELECT 1');
    const row = await db.one('SELECT version() AS version');
    checks.push({ name: 'PostgreSQL', ok: true, detail: String(row?.version ?? '').split(' ').slice(0, 2).join(' ') });
  } catch (error) {
    checks.push({ name: 'PostgreSQL', ok: false, detail: error instanceof Error ? error.message : String(error) });
  } finally {
    await db.close();
  }
} else {
  checks.push({ name: 'PostgreSQL', ok: false, detail: 'DATABASE_URL is not set' });
}

const redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null });
try {
  await redis.connect();
  const pong = await redis.ping();
  checks.push({ name: 'Redis', ok: pong === 'PONG', detail: `${config.redisUrl} -> ${pong}` });
} catch (error) {
  checks.push({ name: 'Redis', ok: false, detail: error instanceof Error ? error.message : String(error) });
} finally {
  redis.disconnect();
}

try {
  await mkdir(config.dataDir, { recursive: true });
  const probe = join(config.dataDir, `.write-test-${process.pid}`);
  await writeFile(probe, 'ok');
  await access(probe, constants.R_OK);
  await rm(probe, { force: true });
  checks.push({ name: 'Data directory', ok: true, detail: `${config.dataDir} is writable` });
} catch (error) {
  checks.push({ name: 'Data directory', ok: false, detail: error instanceof Error ? error.message : String(error) });
}

for (const check of checks) {
  const label = check.ok ? 'OK ' : check.optional ? 'WARN' : 'ERR ';
  console.log(`${label}  ${check.name.padEnd(20)} ${check.detail}`);
}
const failed = checks.filter((check) => !check.ok && !check.optional);
if (failed.length) {
  console.error(`\n${failed.length} required check(s) failed. ConvertLab cannot run correctly until they are resolved.`);
  process.exit(1);
}
console.log('\nAll checks passed. ConvertLab is ready.');
