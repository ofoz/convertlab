import { Busboy, type BusboyHeaders } from '@fastify/busboy';
import { createWriteStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { IncomingMessage } from 'node:http';
import { AppError, Errors } from './errors.ts';

export type UploadedFile = {
  field: string;
  filename: string;
  mime: string;
  path: string;
  size: number;
};

export type MultipartResult = {
  fields: Record<string, string>;
  files: UploadedFile[];
};

export async function readMultipart(
  req: IncomingMessage,
  opts: { dir: string; maxFiles: number; maxFileBytes: number; maxFieldBytes?: number },
): Promise<MultipartResult> {
  const contentType = String(req.headers['content-type'] ?? '');
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw Errors.unsupported('上传请求需使用 multipart/form-data');
  }

  let busboy: ReturnType<typeof Busboy>;
  try {
    busboy = Busboy({
      headers: req.headers as BusboyHeaders,
      limits: {
        files: opts.maxFiles + 1,
        fileSize: opts.maxFileBytes,
        fields: 20,
        fieldSize: opts.maxFieldBytes ?? 64 * 1024,
        parts: opts.maxFiles + 25,
      },
    });
  } catch {
    throw Errors.badRequest('上传请求格式无效');
  }

  return new Promise<MultipartResult>((resolve, reject) => {
    const fields: Record<string, string> = {};
    const files: UploadedFile[] = [];
    const pending: Promise<void>[] = [];
    let settled = false;
    let failure: AppError | null = null;

    const fail = (error: AppError) => {
      if (!failure) failure = error;
    };

    busboy.on('field', (name, value, _nameTruncated, valueTruncated) => {
      if (valueTruncated) {
        fail(Errors.badRequest('表单字段过长'));
        return;
      }
      fields[name] = value;
    });

    busboy.on('file', (name, stream, filename, _encoding, mimeType) => {
      if (files.length >= opts.maxFiles) {
        stream.resume();
        fail(Errors.badRequest(`一次最多上传 ${opts.maxFiles} 个文件`));
        return;
      }
      if (!filename) {
        stream.resume();
        return;
      }

      const id = randomUUID();
      const path = join(opts.dir, `${id}.upload`);
      let size = 0;
      let limited = false;
      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
      });
      stream.on('limit', () => {
        limited = true;
        fail(Errors.tooLarge(`单个文件不能超过 ${Math.round(opts.maxFileBytes / 1024 / 1024)} MB`));
      });

      const uploaded: UploadedFile = {
        field: name,
        filename: filename.slice(0, 255),
        mime: mimeType || 'application/octet-stream',
        path,
        size: 0,
      };
      files.push(uploaded);

      pending.push(
        pipeline(stream, createWriteStream(path, { flags: 'wx', mode: 0o600 }))
          .then(async () => {
            if (limited || failure) return;
            uploaded.size = (await stat(path)).size;
          })
          .catch((error) => {
            fail(Errors.badRequest(`文件上传失败：${error instanceof Error ? error.message : '未知错误'}`));
          }),
      );
    });

    busboy.on('filesLimit', () => fail(Errors.badRequest(`一次最多上传 ${opts.maxFiles} 个文件`)));
    busboy.on('partsLimit', () => fail(Errors.badRequest('上传表单字段过多')));
    busboy.on('error', () => fail(Errors.badRequest('上传请求解析失败')));

    const finalize = () => {
      void (async () => {
        try {
          await Promise.allSettled(pending);
          if (settled) return;
          settled = true;
          if (failure) {
            await cleanup(files);
            reject(failure);
            return;
          }
          if (files.length === 0) throw Errors.badRequest('请至少选择一个文件');
          resolve({ fields, files });
        } catch (error) {
          await cleanup(files);
          reject(error);
        }
      })();
    };
    busboy.on('finish', finalize);
    busboy.on('close', finalize);

    req.on('aborted', () => {
      fail(Errors.badRequest('上传已中断'));
      busboy.destroy();
    });

    req.pipe(busboy);
  });
}

export async function cleanup(files: UploadedFile[]): Promise<void> {
  await Promise.all(files.map((file) => rm(file.path, { force: true }).catch(() => {})));
}
