import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { applyDocumentCsp, setCommonHeaders } from './http.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

export async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  publicDir: string,
  pathname: string,
  spaFallback = true,
): Promise<boolean> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  if (decoded.includes('\0')) return false;

  const relative = decoded.replace(/^\/+/, '');
  let filePath = resolve(join(publicDir, normalize(relative)));
  const root = resolve(publicDir);
  if (filePath !== root && !filePath.startsWith(root + sep)) return false;

  let info = await stat(filePath).catch(() => null);
  if (info?.isDirectory()) {
    filePath = join(filePath, 'index.html');
    info = await stat(filePath).catch(() => null);
  }
  if (!info?.isFile() && spaFallback) {
    filePath = join(root, 'index.html');
    info = await stat(filePath).catch(() => null);
    if (info?.isFile()) applyDocumentCsp(res);
  }
  if (!info?.isFile()) return false;

  setCommonHeaders(res);
  if (filePath.endsWith('.html')) applyDocumentCsp(res);
  const ext = extname(filePath).toLowerCase();
  res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
  res.setHeader('Content-Length', String(info.size));
  res.setHeader(
    'Cache-Control',
    filePath.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
  );
  if (req.method === 'HEAD') {
    res.statusCode = 200;
    res.end();
    return true;
  }
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    res.on('close', resolvePromise);
    res.on('finish', resolvePromise);
    stream.pipe(res);
  });
  return true;
}
