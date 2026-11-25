import { AppError, Errors } from './errors.ts';
import { FORMATS, type ConversionOptions, type FormatExt, type FormatKind } from '../converters/formats.ts';

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainObject(value)) throw Errors.badRequest(`${label}格式无效`);
  return value;
}

export function requireString(value: unknown, label: string, maxLength = 500): string {
  if (typeof value !== 'string') throw Errors.badRequest(`${label}格式无效`);
  const text = value.trim();
  if (!text) throw Errors.badRequest(`${label}不能为空`);
  if (text.length > maxLength) throw Errors.badRequest(`${label}过长`);
  return text;
}

export function optionalString(value: unknown, label: string, maxLength = 500): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return requireString(value, label, maxLength);
}

export function toInt(value: unknown, label: string, min: number, max: number, fallback?: number): number {
  if ((value === undefined || value === null || value === '') && fallback !== undefined) return fallback;
  const num = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(num) || num < min || num > max) throw Errors.badRequest(`${label}需要在 ${min} 到 ${max} 之间`);
  return num;
}

export function optionalInt(value: unknown, label: string, min: number, max: number): number | null {
  if (value === undefined || value === null || value === '') return null;
  return toInt(value, label, min, max);
}

export function normalizeEmail(value: unknown): string {
  const email = requireString(value, '邮箱', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Errors.badRequest('邮箱格式无效');
  return email;
}

export function normalizeTarget(value: unknown): string {
  const target = requireString(value, '目标格式', 10).toLowerCase();
  if (!(target in FORMATS)) throw Errors.badRequest('不支持的目标格式');
  return target;
}

export function parseOptions(value: unknown, target: string): ConversionOptions {
  if (value === undefined || value === null) return {};
  const raw = asRecord(value, '转换参数');
  const options: ConversionOptions = {};

  const imageRaw = raw.image;
  if (imageRaw !== undefined) {
    const image = asRecord(imageRaw, '图片参数');
    const quality = toInt(image.quality, '图片质量', 1, 100, 85);
    const maxDimension = optionalInt(image.maxDimension, '最长边', 16, 20_000);
    const backgroundRaw = typeof image.background === 'string' ? image.background : '#ffffff';
    if (!/^#[0-9a-fA-F]{6}$/.test(backgroundRaw)) throw Errors.badRequest('背景色需为 #RRGGBB 格式');
    options.image = { quality, maxDimension, background: backgroundRaw, preserveAlpha: image.preserveAlpha !== false };
  }

  const audioRaw = raw.audio;
  if (audioRaw !== undefined) {
    const audio = asRecord(audioRaw, '音频参数');
    const channels = audio.channels ?? 'source';
    if (!['mono', 'stereo', 'source'].includes(String(channels))) throw Errors.badRequest('声道参数无效');
    options.audio = {
      bitrateKbps: toInt(audio.bitrateKbps, '音频码率', 32, 512, 192),
      sampleRate: optionalInt(audio.sampleRate, '采样率', 8_000, 192_000),
      channels: channels as 'mono' | 'stereo' | 'source',
    };
  }

  const pdfRaw = raw.pdf;
  if (pdfRaw !== undefined) {
    const pdf = asRecord(pdfRaw, 'PDF 参数');
    const mode = pdf.mode ?? 'editable';
    if (mode !== 'editable' && mode !== 'layout') throw Errors.badRequest('PDF 转换模式无效');
    const sheetMode = pdf.sheetMode ?? 'single';
    if (sheetMode !== 'single' && sheetMode !== 'page') throw Errors.badRequest('Excel 工作表模式无效');
    options.pdf = {
      mode,
      dpi: toInt(pdf.dpi, 'PDF 分辨率', 72, 600, 150),
      ocr: pdf.ocr === true,
      sheetMode,
      secondDetector: pdf.secondDetector !== false,
    };
  }

  if (target === 'pdf' && raw.document !== undefined) {
    const doc = asRecord(raw.document, '文档参数');
    const mode = doc.pdfLayout ?? 'editable';
    if (mode !== 'editable' && mode !== 'layout') throw Errors.badRequest('文档 PDF 模式无效');
    options.document = { pdfLayout: mode };
  }
  return options;
}

export function formatKindForUpload(ext: string, sniffedKind: FormatKind | 'archive' | 'unknown'): FormatKind {
  if (sniffedKind === 'archive') throw Errors.unsupported('压缩包不能直接转换');
  if (sniffedKind === 'unknown') throw Errors.unsupported('无法识别文件内容');
  const known = (FORMATS[ext as FormatExt] as { kind: FormatKind } | undefined)?.kind;
  if (!known) throw Errors.unsupported('不支持此文件扩展名');
  if (known !== sniffedKind && !(known === 'pdf' && sniffedKind === 'pdf') && !(known === 'video' && sniffedKind === 'audio')) {
    // HEIC is an ISO-BMFF container and may be classified as video by a shallow probe.
    if (!(ext === 'heic' && sniffedKind === 'video')) throw Errors.unsupported('文件内容与扩展名不匹配');
  }
  return known;
}

export function safeFilename(filename: string): string {
  const cleaned = filename
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
  return cleaned || 'file';
}

export function requireCsrf(header: string | undefined, expected: string): void {
  if (!header || header !== expected) throw new AppError(403, 'CSRF_FAILED', '安全校验失败，请刷新页面后重试');
}
