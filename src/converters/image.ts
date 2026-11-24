import sharp from 'sharp';
import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { runCommand, CommandError } from './process.ts';
import { ConversionError, type ConvertOutcome, type ConverterInput } from './types.ts';

export async function requireOutput(path: string): Promise<number> {
  const info = await stat(path).catch(() => null);
  if (!info || info.size === 0) throw new ConversionError('转换未生成有效文件');
  return info.size;
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

async function decodeHeic(input: ConverterInput): Promise<string> {
  const target = join(input.workDir, 'decoded.png');
  try {
    await runCommand(input.bins.ffmpeg, ['-y', '-i', input.inputPath, target], { timeoutMs: 120_000, signal: input.signal });
  } catch (error) {
    if (error instanceof CommandError) throw new ConversionError('无法解码 HEIC/HEIF 图片，请安装 libheif 支持或改传 JPG/PNG');
    throw error;
  }
  return target;
}

async function imageToPdf(input: ConverterInput): Promise<ConvertOutcome> {
  const buildDir = join(input.workDir, 'pdf-build');
  await ensureDir(buildDir);
  let source = input.inputPath;
  if (input.sourceExt === 'heic') source = await decodeHeic(input);

  const pagePath = join(buildDir, 'page.png');
  await sharp(source, { failOn: 'error', limitInputPixels: 268_402_689 })
    .rotate()
    .flatten({ background: input.options.image?.background ?? '#ffffff' })
    .png()
    .toFile(pagePath);

  await runCommand(input.bins.soffice, ['--headless', '--norestore', `-env:UserInstallation=file://${join(input.workDir, 'lo-profile')}`, '--convert-to', 'pdf', '--outdir', buildDir, pagePath], {
    timeoutMs: Math.min(input.timeoutMs, 180_000),
    signal: input.signal,
  });
  const produced = join(buildDir, 'page.pdf');
  input.onProgress?.(100);
  await requireOutput(produced);
  return { outputPath: produced, outputExt: 'pdf' };
}

export async function convertImage(input: ConverterInput): Promise<ConvertOutcome> {
  input.onProgress?.(15);
  if (input.target === 'pdf') return imageToPdf(input);

  const maxDimension = input.options.image?.maxDimension ?? null;
  const quality = input.options.image?.quality ?? 85;
  const background = input.options.image?.background ?? '#ffffff';
  const outputPath = join(input.outputDir, `${input.outputBase}.${input.target}`);

  if (input.target === 'bmp') {
    const args = ['-y', '-i', input.inputPath, '-frames:v', '1'];
    if (maxDimension) args.push('-vf', `scale='min(${maxDimension},iw)':'min(${maxDimension},ih)':force_original_aspect_ratio=decrease`);
    args.push(outputPath);
    await runCommand(input.bins.ffmpeg, args, { timeoutMs: Math.min(input.timeoutMs, 120_000), signal: input.signal });
    input.onProgress?.(100);
    await requireOutput(outputPath);
    return { outputPath, outputExt: 'bmp' };
  }

  let source = input.inputPath;
  if (input.sourceExt === 'heic' && !sharp.format.heif.input.file) source = await decodeHeic(input);

  let pipeline = sharp(source, { failOn: 'error', limitInputPixels: 268_402_689 }).rotate();
  if (maxDimension) pipeline = pipeline.resize({ width: maxDimension, height: maxDimension, fit: 'inside', withoutEnlargement: true });

  switch (input.target) {
    case 'png':
      pipeline = pipeline.png({ compressionLevel: 8, adaptiveFiltering: true });
      break;
    case 'jpg':
      pipeline = pipeline.flatten({ background }).jpeg({ quality, mozjpeg: true });
      break;
    case 'webp':
      pipeline = pipeline.webp({ quality, alphaQuality: 100 });
      break;
    case 'gif':
      pipeline = pipeline.gif();
      break;
    case 'tiff':
      pipeline = pipeline.tiff({ compression: 'lzw', quality });
      break;
    default:
      throw new ConversionError('不支持的图片目标格式');
  }

  input.onProgress?.(60);
  await pipeline.toFile(outputPath);
  input.onProgress?.(100);
  await requireOutput(outputPath);
  return { outputPath, outputExt: input.target };
}

export async function imageMetadata(path: string): Promise<{ width: number; height: number }> {
  const meta = await sharp(path, { failOn: 'none' }).metadata().catch(() => null);
  return { width: meta?.width ?? 1000, height: meta?.height ?? 1414 };
}

export async function readRenderedPages(dir: string, format: string): Promise<string[]> {
  const entries = await readdir(dir).catch(() => [] as string[]);
  return entries
    .filter((name) => name.startsWith('page-') && name.endsWith(`.${format}`))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name) => join(dir, name));
}

export async function pageImages(paths: string[], format: 'jpg' | 'png') {
  const pages = [];
  for (const path of paths) {
    const data = await readFile(path);
    const meta = await sharp(data).metadata();
    pages.push({ data, format, widthPx: meta.width ?? 1000, heightPx: meta.height ?? 1414 });
  }
  return pages;
}
