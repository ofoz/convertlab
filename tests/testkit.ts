import { spawnSync } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Bins } from '../src/converters/types.ts';

const here = dirname(fileURLToPath(import.meta.url));

/** Minimal ZIP reader for asserting on generated OOXML packages. */
export function unzip(buffer: Buffer): Map<string, Buffer> {
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('not a zip archive');
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map<string, Buffer>();
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('bad central directory');
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    entries.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function textPart(buffer: Buffer, name: string): string {
  const entries = unzip(buffer);
  const part = entries.get(name);
  if (!part) throw new Error(`missing part ${name}; have ${[...entries.keys()].join(', ')}`);
  return part.toString('utf8');
}

export function countOf(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

export const fixture = (name: string): string => join(here, 'fixtures', name);

export const BINS: Bins = {
  soffice: process.env.SOFFICE_PATH ?? 'soffice',
  ffmpeg: process.env.FFMPEG_PATH ?? 'ffmpeg',
  ffprobe: process.env.FFPROBE_PATH ?? 'ffprobe',
  gs: process.env.GS_PATH ?? 'gs',
  pdftoppm: process.env.PDFTOPPM_PATH ?? 'pdftoppm',
  pdftotext: process.env.PDFTOTEXT_PATH ?? 'pdftotext',
  pdftocairo: process.env.PDFTOCAIRO_PATH ?? 'pdftocairo',
  pdfinfo: process.env.PDFINFO_PATH ?? 'pdfinfo',
  ocrmypdf: process.env.OCRMYPDF_PATH ?? 'ocrmypdf',
  tesseract: process.env.TESSERACT_PATH ?? 'tesseract',
};

/**
 * True when the executable is present. Each tool uses a different flag to
 * report its version, so callers pass the probe arguments explicitly.
 */
export function hasBin(bin: string, args: string[] = ['-v']): boolean {
  const result = spawnSync(bin, args, { stdio: 'ignore', timeout: 20_000 });
  if (!result.error && result.status === 0) return true;
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return false;
  // Some tools (LibreOffice, ffmpeg) exit non-zero for version probes.
  const probe = spawnSync('sh', ['-c', `command -v ${JSON.stringify(bin)} >/dev/null 2>&1`], { stdio: 'ignore' });
  return probe.status === 0;
}

export const e2eEnabled = process.env.CONVERTLAB_E2E === '1';
export const POppler = hasBin('pdftotext');
export const LIBREOFFICE = hasBin('soffice', ['--version']);
