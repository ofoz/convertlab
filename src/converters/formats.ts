export const FORMATS = {
  png: { label: 'PNG', kind: 'image', mimes: ['image/png'] },
  jpg: { label: 'JPG', kind: 'image', mimes: ['image/jpeg'] },
  webp: { label: 'WebP', kind: 'image', mimes: ['image/webp'] },
  gif: { label: 'GIF', kind: 'image', mimes: ['image/gif'] },
  bmp: { label: 'BMP', kind: 'image', mimes: ['image/bmp', 'image/x-bmp'] },
  tiff: { label: 'TIFF', kind: 'image', mimes: ['image/tiff'] },
  heic: { label: 'HEIC', kind: 'image', mimes: ['image/heic', 'image/heif'] },
  pdf: { label: 'PDF', kind: 'pdf', mimes: ['application/pdf'] },
  doc: { label: 'DOC', kind: 'document', mimes: ['application/msword'] },
  docx: { label: 'DOCX', kind: 'document', mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'] },
  odt: { label: 'ODT', kind: 'document', mimes: ['application/vnd.oasis.opendocument.text'] },
  rtf: { label: 'RTF', kind: 'document', mimes: ['application/rtf', 'text/rtf'] },
  txt: { label: 'Text', kind: 'document', mimes: ['text/plain'] },
  xls: { label: 'XLS', kind: 'document', mimes: ['application/vnd.ms-excel'] },
  xlsx: { label: 'XLSX', kind: 'document', mimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] },
  ods: { label: 'ODS', kind: 'document', mimes: ['application/vnd.oasis.opendocument.spreadsheet'] },
  csv: { label: 'CSV', kind: 'document', mimes: ['text/csv', 'text/plain'] },
  ppt: { label: 'PPT', kind: 'document', mimes: ['application/vnd.ms-powerpoint'] },
  pptx: { label: 'PPTX', kind: 'document', mimes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'] },
  odp: { label: 'ODP', kind: 'document', mimes: ['application/vnd.oasis.opendocument.presentation'] },
  mp3: { label: 'MP3', kind: 'audio', mimes: ['audio/mpeg'] },
  wav: { label: 'WAV', kind: 'audio', mimes: ['audio/wav', 'audio/x-wav'] },
  m4a: { label: 'M4A', kind: 'audio', mimes: ['audio/mp4', 'audio/x-m4a'] },
  aac: { label: 'AAC', kind: 'audio', mimes: ['audio/aac', 'audio/x-aac'] },
  flac: { label: 'FLAC', kind: 'audio', mimes: ['audio/flac', 'audio/x-flac'] },
  ogg: { label: 'OGG', kind: 'audio', mimes: ['audio/ogg'] },
  mp4: { label: 'MP4', kind: 'video', mimes: ['video/mp4'] },
  mov: { label: 'MOV', kind: 'video', mimes: ['video/quicktime'] },
  mkv: { label: 'MKV', kind: 'video', mimes: ['video/x-matroska'] },
  webm: { label: 'WebM', kind: 'video', mimes: ['video/webm'] },
  zip: { label: 'ZIP', kind: 'archive', mimes: ['application/zip'] },
} as const;

export type FormatExt = keyof typeof FORMATS;
export type FormatKind = (typeof FORMATS)[FormatExt]['kind'];

export const IMAGE_EXTS = ['png', 'jpg', 'webp', 'gif', 'bmp', 'tiff', 'heic'] as const;
export const PDF_EXTS = ['pdf'] as const;
export const WRITER_EXTS = ['doc', 'docx', 'odt', 'rtf', 'txt'] as const;
export const CALC_EXTS = ['xls', 'xlsx', 'ods', 'csv'] as const;
export const IMPRESS_EXTS = ['ppt', 'pptx', 'odp'] as const;
export const DOCUMENT_EXTS = [...WRITER_EXTS, ...CALC_EXTS, ...IMPRESS_EXTS] as const;
export const AUDIO_EXTS = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'] as const;
export const VIDEO_EXTS = ['mp4', 'mov', 'mkv', 'webm'] as const;

export const IMAGE_TARGETS = [...IMAGE_EXTS, 'pdf'] as const;
export const DOCUMENT_TARGETS = ['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'xls', 'xlsx', 'ods', 'csv', 'ppt', 'pptx', 'odp'] as const;
export const PDF_TARGETS = ['docx', 'odt', 'rtf', 'txt', 'xlsx', 'pptx', 'odp', 'png', 'jpg'] as const;
export const AUDIO_TARGETS = [...AUDIO_EXTS] as const;
export const VIDEO_TARGETS = AUDIO_TARGETS;

export type OutputTarget = (typeof IMAGE_TARGETS)[number] | (typeof DOCUMENT_TARGETS)[number] | (typeof PDF_TARGETS)[number];

export type ConversionOptions = {
  image?: { quality: number; maxDimension: number | null; background: string; preserveAlpha: boolean };
  audio?: { bitrateKbps: number; sampleRate: number | null; channels: 'mono' | 'stereo' | 'source' };
  pdf?: { mode: 'editable' | 'layout'; dpi: number; ocr?: boolean; sheetMode?: 'single' | 'page'; secondDetector?: boolean };
  document?: { pdfLayout: 'editable' | 'layout' };
};

export type SourceDescriptor = { ext: string; kind: FormatKind; originalName: string };

const OFFICE_GROUP: Record<string, 'writer' | 'calc' | 'impress'> = {
  doc: 'writer', docx: 'writer', odt: 'writer', rtf: 'writer', txt: 'writer',
  xls: 'calc', xlsx: 'calc', ods: 'calc', csv: 'calc',
  ppt: 'impress', pptx: 'impress', odp: 'impress',
};

export function officeGroup(ext: string): 'writer' | 'calc' | 'impress' | null {
  return OFFICE_GROUP[ext] ?? null;
}

export function targetKind(target: string): FormatKind | null {
  return (FORMATS[target as FormatExt] as { kind: FormatKind } | undefined)?.kind ?? null;
}

export function mimeFor(ext: string): string {
  return (FORMATS[ext as FormatExt] as { mimes: readonly string[] } | undefined)?.mimes[0] ?? 'application/octet-stream';
}

export type PlanResult = { allowed: true } | { allowed: false; reason: string };

/**
 * The conversion matrix is deliberately explicit. UI and API share this
 * function so that a disabled choice cannot be bypassed by posting directly.
 */
export function validateConversion(source: SourceDescriptor, target: string): PlanResult {
  const targetK = targetKind(target);
  if (!targetK) return { allowed: false, reason: '不支持的目标格式' };

  if (target === source.ext) return { allowed: false, reason: '源格式与目标格式相同' };

  if (source.kind === 'image') {
    if (!(IMAGE_TARGETS as readonly string[]).includes(target)) return { allowed: false, reason: '图片不能转换为该格式' };
    return { allowed: true };
  }

  if (source.kind === 'pdf') {
    if (!(PDF_TARGETS as readonly string[]).includes(target)) return { allowed: false, reason: 'PDF 不能转换为该格式' };
    return { allowed: true };
  }

  if (source.kind === 'document') {
    if (!(DOCUMENT_TARGETS as readonly string[]).includes(target)) return { allowed: false, reason: '文档不能转换为该格式' };
    // Only same application-family conversions are safe through headless LibreOffice.
    const sourceGroup = officeGroup(source.ext);
    const targetGroup = officeGroup(target);
    if (target !== 'pdf' && sourceGroup && targetGroup && sourceGroup !== targetGroup) {
      return { allowed: false, reason: '文字、表格和演示文稿不能直接跨类型转换；请先转为 PDF' };
    }
    return { allowed: true };
  }

  if (source.kind === 'audio' || source.kind === 'video') {
    if (!(AUDIO_TARGETS as readonly string[]).includes(target)) return { allowed: false, reason: '媒体文件只能转换为音频格式' };
    return { allowed: true };
  }

  return { allowed: false, reason: '无法识别此文件的转换能力' };
}

export function targetsFor(sourceExt: string, kind: FormatKind): readonly string[] {
  if (kind === 'image') return IMAGE_TARGETS.filter((x) => x !== sourceExt);
  if (kind === 'pdf') return PDF_TARGETS;
  if (kind === 'document') return DOCUMENT_TARGETS.filter((x) => x !== sourceExt && validateConversion({ ext: sourceExt, kind, originalName: '' }, x).allowed);
  if (kind === 'audio') return AUDIO_TARGETS.filter((x) => x !== sourceExt);
  if (kind === 'video') return VIDEO_TARGETS;
  return [];
}

export const FORMAT_CATALOG = {
  image: IMAGE_EXTS,
  pdf: PDF_EXTS,
  document: DOCUMENT_EXTS,
  audio: AUDIO_EXTS,
  video: VIDEO_EXTS,
};
