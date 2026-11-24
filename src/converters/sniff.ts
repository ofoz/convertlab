import { open } from 'node:fs/promises';

export type SniffResult = { ext: string | null; kind: 'image' | 'document' | 'audio' | 'video' | 'pdf' | 'archive' | 'unknown'; detail?: string };

const OLE_MAP: Record<string, string> = {
  doc: 'document',
  xls: 'document',
  ppt: 'document',
};

function readAscii(buf: Buffer, start: number, end: number): string {
  return buf.subarray(start, end).toString('latin1');
}

/** Inspect the first bytes of a file so the extension alone never decides how we treat it. */
export async function sniffFile(path: string): Promise<SniffResult> {
  const handle = await open(path, 'r');
  try {
    const buf = Buffer.alloc(512);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    const head = buf.subarray(0, bytesRead);
    if (head.length < 4) return { ext: null, kind: 'unknown', detail: '文件内容为空或过短' };

    if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return { ext: 'png', kind: 'image' };
    if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { ext: 'jpg', kind: 'image' };
    if (readAscii(head, 0, 4) === 'GIF8') return { ext: 'gif', kind: 'image' };
    if (readAscii(head, 0, 4) === 'RIFF' && readAscii(head, 8, 12) === 'WEBP') return { ext: 'webp', kind: 'image' };
    if (readAscii(head, 0, 2) === 'BM') return { ext: 'bmp', kind: 'image' };
    if ((head[0] === 0x49 && head[1] === 0x49 && head[2] === 0x2a) || (head[0] === 0x4d && head[1] === 0x4d && head[2] === 0x00)) {
      return { ext: 'tiff', kind: 'image' };
    }
    if (readAscii(head, 0, 4) === '%PDF') return { ext: 'pdf', kind: 'pdf' };
    if (readAscii(head, 0, 5) === '{\\rtf') return { ext: 'rtf', kind: 'document' };
    if (readAscii(head, 0, 4) === 'RIFF' && readAscii(head, 8, 12) === 'WAVE') return { ext: 'wav', kind: 'audio' };
    if (readAscii(head, 0, 4) === 'fLaC') return { ext: 'flac', kind: 'audio' };
    if (readAscii(head, 0, 4) === 'OggS') return { ext: 'ogg', kind: 'audio' };
    if (readAscii(head, 0, 4) === 'ID3' || (head[0] === 0xff && (head[1]! & 0xe0) === 0xe0)) return { ext: 'mp3', kind: 'audio' };
    if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return { ext: 'mkv', kind: 'video' };

    if (readAscii(head, 4, 8) === 'ftyp') {
      const brand = readAscii(head, 8, 12);
      if (/^(heic|heix|hevc|heim|heis|mif1|msf1)/.test(brand)) return { ext: 'heic', kind: 'image' };
      if (/^(M4A|M4B|m4a)/.test(brand)) return { ext: 'm4a', kind: 'audio' };
      if (brand === 'qt  ') return { ext: 'mov', kind: 'video' };
      return { ext: 'mp4', kind: 'video' };
    }

    if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) {
      const hint = OLE_MAP[detectOleExt(head)] ?? 'document';
      return { ext: detectOleExt(head), kind: hint as SniffResult['kind'] };
    }

    if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
      const ext = detectZipOfficeExt(head);
      if (ext) return { ext, kind: 'document' };
      return { ext: null, kind: 'archive' };
    }

    const textHead = head.subarray(0, Math.min(head.length, 256));
    const printable = textHead.every((byte) => byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte < 127) || byte >= 0xc2);
    if (printable) return { ext: 'txt', kind: 'document' };
    return { ext: null, kind: 'unknown' };
  } finally {
    await handle.close();
  }
}

function detectOleExt(head: Buffer): string {
  const text = head.toString('latin1');
  if (text.includes('WordDocument')) return 'doc';
  if (text.includes('Workbook') || text.includes('Book')) return 'xls';
  if (text.includes('PowerPoint')) return 'ppt';
  return 'doc';
}

function detectZipOfficeExt(head: Buffer): string | null {
  const text = head.toString('latin1');
  if (text.includes('word/')) return 'docx';
  if (text.includes('xl/')) return 'xlsx';
  if (text.includes('ppt/')) return 'pptx';
  if (text.includes('mimetypeapplication/vnd.oasis.opendocument.text')) return 'odt';
  return null;
}

/** Deeper ZIP check for OOXML/ODF containers whose first bytes only show the zip entry list. */
export async function sniffZipContainer(path: string): Promise<string | null> {
  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat();
    const size = Math.min(stat.size, 8192);
    const buf = Buffer.alloc(size);
    await handle.read(buf, 0, size, 0);
    const text = buf.toString('latin1');
    if (text.includes('word/document.xml')) return 'docx';
    if (text.includes('xl/workbook.xml')) return 'xlsx';
    if (text.includes('ppt/presentation.xml')) return 'pptx';
    if (text.includes('application/vnd.oasis.opendocument.text')) return 'odt';
    if (text.includes('application/vnd.oasis.opendocument.spreadsheet')) return 'ods';
    if (text.includes('application/vnd.oasis.opendocument.presentation')) return 'odp';
    return null;
  } finally {
    await handle.close();
  }
}
