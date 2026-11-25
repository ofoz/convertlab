import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { runCommand } from './process.ts';
import type { ConverterInput } from './types.ts';

/**
 * Table-rule detection for scanned / image-only PDF pages.
 *
 * A page that is just a photograph of paper has no vector line art, so the
 * SVG based grid detection in `pdf-tables.ts` sees nothing and OCR text alone
 * cannot reveal where the cell borders were. This module renders the page to a
 * grayscale bitmap and rebuilds the rules from the pixels: long, thin dark runs
 * are table borders, everything else (glyph strokes, shading, logos) is not.
 *
 * The result is a list of segments in PDF points, in the exact shape
 * `detectGridTables()` already consumes, so scanned tables are rebuilt into
 * bordered cells with the same code path as digital ones.
 */

export const RASTER_DPI = 300;
/** Guard against pathological page boxes; 40M pixels is a very large A0 sheet. */
const MAX_PIXELS = 40_000_000;
/** A rule must be at least this long (relative to the page) to count. */
const MIN_RULE_RATIO = 0.08;
const MIN_VERTICAL_RATIO = 0.015;
/** Allowed gap inside a rule: anti-aliasing and JPEG noise break hairlines. */
const RUN_GAP_PX = 4;
/** A rule is thin: at most this many pixels thick. */
const MAX_RULE_THICKNESS = 6;

export type RasterSegment = { x0: number; y0: number; x1: number; y1: number };
export type PgmImage = { width: number; height: number; data: Uint8Array };
export type RasterRules = {
  horizontals: Array<{ y: number; x0: number; x1: number }>;
  verticals: Array<{ x: number; y0: number; y1: number }>;
};

/** Minimal binary PGM (P5) reader. pdftoppm -gray writes exactly this format. */
export function parsePgm(buffer: Buffer): PgmImage | null {
  if (buffer.length < 16 || buffer[0] !== 0x50 || buffer[1] !== 0x35) return null;
  let index = 2;
  const nextToken = (): string | null => {
    for (;;) {
      while (index < buffer.length) {
        const code = buffer[index]!;
        if (code === 0x23) {
          while (index < buffer.length && buffer[index] !== 0x0a) index += 1;
          continue;
        }
        if (code === 0x20 || code === 0x0d || code === 0x09 || code === 0x0a) {
          index += 1;
          continue;
        }
        break;
      }
      if (index >= buffer.length) return null;
      const start = index;
      while (index < buffer.length) {
        const code = buffer[index]!;
        if (code === 0x20 || code === 0x0d || code === 0x09 || code === 0x0a || code === 0x23) break;
        index += 1;
      }
      return buffer.toString('latin1', start, index);
    }
  };

  const width = Number.parseInt(nextToken() ?? '', 10);
  const height = Number.parseInt(nextToken() ?? '', 10);
  const maxval = Number.parseInt(nextToken() ?? '', 10);
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(maxval)) return null;
  if (width <= 0 || height <= 0 || maxval <= 0 || maxval > 65535) return null;
  if (index >= buffer.length) return null;
  // Exactly one whitespace byte separates the header from the raster payload.
  index += 1;
  const bytesPerSample = maxval > 255 ? 2 : 1;
  const samples = width * height;
  if (buffer.length - index < samples * bytesPerSample) return null;

  const data = new Uint8Array(samples);
  if (bytesPerSample === 1) {
    const scale = maxval === 255 ? 1 : 255 / maxval;
    if (scale === 1) data.set(buffer.subarray(index, index + samples));
    else for (let i = 0; i < samples; i += 1) data[i] = Math.min(255, Math.round(buffer[index + i]! * scale));
  } else {
    for (let i = 0; i < samples; i += 1) {
      const high = buffer[index + i * 2]!;
      const low = buffer[index + i * 2 + 1]!;
      data[i] = Math.round(((high << 8) | low) / 257);
    }
  }
  return { width, height, data };
}

/** Longest dark run through every pixel, measured horizontally and vertically. */
function runLengths(dark: Uint8Array, width: number, height: number): { h: Uint16Array; v: Uint16Array } {
  const total = width * height;
  const h = new Uint16Array(total);
  const v = new Uint16Array(total);

  const forward = new Uint16Array(width);
  const backward = new Uint16Array(width);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let count = 0;
    for (let x = 0; x < width; x += 1) {
      count = dark[row + x] ? count + 1 : 0;
      forward[x] = count;
    }
    count = 0;
    for (let x = width - 1; x >= 0; x -= 1) {
      count = dark[row + x] ? count + 1 : 0;
      backward[x] = count;
    }
    for (let x = 0; x < width; x += 1) {
      const lead = forward[x]!;
      if (lead > 0) h[row + x] = lead + backward[x]! - 1;
    }
  }

  const down = new Uint16Array(height);
  const up = new Uint16Array(height);
  for (let x = 0; x < width; x += 1) {
    let count = 0;
    for (let y = 0; y < height; y += 1) {
      count = dark[y * width + x] ? count + 1 : 0;
      down[y] = count;
    }
    count = 0;
    for (let y = height - 1; y >= 0; y -= 1) {
      count = dark[y * width + x] ? count + 1 : 0;
      up[y] = count;
    }
    for (let y = 0; y < height; y += 1) {
      const lead = down[y]!;
      if (lead > 0) v[y * width + x] = lead + up[y]! - 1;
    }
  }

  return { h, v };
}

/** Background gray level (90th percentile) turned into a "not paper" cutoff. */
function darkThreshold(data: Uint8Array): number {
  const histogram = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 1) {
    const value = data[i]!;
    histogram[value] = histogram[value]! + 1;
  }
  const target = data.length * 0.9;
  let seen = 0;
  let background = 255;
  for (let value = 0; value < 256; value += 1) {
    seen += histogram[value]!;
    if (seen >= target) {
      background = value;
      break;
    }
  }
  return Math.max(64, background - 14);
}

/**
 * Finds table rules in a page bitmap.
 *
 * A pixel belongs to a horizontal rule when its dark run is long horizontally
 * and thin vertically; vertical rules are the mirror image. The extra density
 * check rejects glyph strokes and shading blocks, which produce long runs too
 * but sit inside a lot of other dark pixels.
 */
export function rasterRules(image: PgmImage): RasterRules {
  const { width, height, data } = image;
  const total = width * height;
  const empty: RasterRules = { horizontals: [], verticals: [] };
  if (total === 0 || total > MAX_PIXELS) return empty;

  const threshold = darkThreshold(data);
  const dark = new Uint8Array(total);
  let darkCount = 0;
  for (let i = 0; i < total; i += 1) {
    if (data[i]! < threshold) {
      dark[i] = 1;
      darkCount += 1;
    }
  }
  // A page that is mostly dark is an inverted scan (or a photo); line rules are
  // meaningless there and the thresholds below would fire on everything.
  if (darkCount > total * 0.5) return empty;

  const { h: hRun, v: vRun } = runLengths(dark, width, height);
  const minHorizontal = Math.max(36, Math.round(width * MIN_RULE_RATIO));
  const minVertical = Math.max(24, Math.round(height * MIN_VERTICAL_RATIO));

  const bandDensity = (x0: number, x1: number, y0: number, y1: number): number => {
    const left = Math.max(0, x0);
    const right = Math.min(width - 1, x1);
    const top = Math.max(0, y0);
    const bottom = Math.min(height - 1, y1);
    let count = 0;
    for (let y = top; y <= bottom; y += 1) {
      const row = y * width;
      for (let x = left; x <= right; x += 1) count += dark[row + x]!;
    }
    const area = (right - left + 1) * (bottom - top + 1);
    return area > 0 ? count / area : 1;
  };

  const horizontals: RasterRules['horizontals'] = [];
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let start = -1;
    let previous = -1;
    const flush = (): void => {
      if (start < 0 || previous - start + 1 < minHorizontal) {
        start = -1;
        return;
      }
      if (bandDensity(start, previous, y - 4, y + 4) <= 0.5) {
        horizontals.push({ y, x0: start, x1: previous });
      }
      start = -1;
    };
    for (let x = 0; x < width; x += 1) {
      const qualifies = hRun[row + x]! >= minHorizontal && vRun[row + x]! <= MAX_RULE_THICKNESS;
      if (!qualifies) {
        if (start >= 0 && x - previous > RUN_GAP_PX) flush();
        continue;
      }
      if (start < 0) start = x;
      previous = x;
    }
    if (start >= 0) flush();
  }

  const verticals: RasterRules['verticals'] = [];
  for (let x = 0; x < width; x += 1) {
    let start = -1;
    let previous = -1;
    const flush = (): void => {
      if (start < 0 || previous - start + 1 < minVertical) {
        start = -1;
        return;
      }
      if (bandDensity(x - 4, x + 4, start, previous) <= 0.5) {
        verticals.push({ x, y0: start, y1: previous });
      }
      start = -1;
    };
    for (let y = 0; y < height; y += 1) {
      const offset = y * width + x;
      const qualifies = vRun[offset]! >= minVertical && hRun[offset]! <= MAX_RULE_THICKNESS;
      if (!qualifies) {
        if (start >= 0 && y - previous > RUN_GAP_PX) flush();
        continue;
      }
      if (start < 0) start = y;
      previous = y;
    }
    if (start >= 0) flush();
  }

  return { horizontals, verticals };
}

/** Converts pixel rules into PDF points for one page. */
export function rulesToSegments(rules: RasterRules, scaleX: number, scaleY: number): RasterSegment[] {
  const segments: RasterSegment[] = [];
  for (const line of rules.horizontals) {
    const y = line.y * scaleY;
    segments.push({ x0: line.x0 * scaleX, y0: y, x1: line.x1 * scaleX, y1: y });
  }
  for (const line of rules.verticals) {
    const x = line.x * scaleX;
    segments.push({ x0: x, y0: line.y0 * scaleY, x1: x, y1: line.y1 * scaleY });
  }
  return segments;
}

export type RasterPageRequest = { index: number; width: number; height: number };

/**
 * Renders the requested pages and returns their table rules in points.
 *
 * Rendering is the slow part, so pages are grouped into contiguous runs and the
 * whole pass is best effort: any failure just means "no pixel rules", and the
 * caller keeps whatever the text/SVG path produced.
 */
export async function detectImageTableLines(
  input: ConverterInput,
  pages: RasterPageRequest[],
): Promise<Map<number, RasterSegment[]>> {
  const result = new Map<number, RasterSegment[]>();
  if (pages.length === 0) return result;

  const token = `${process.pid}-${randomUUID()}`;
  const dir = join(input.workDir, `raster-${token}`);
  const prefix = join(dir, 'page');
  const wanted = new Map(pages.map((page) => [page.index, page]));
  const indexes = [...wanted.keys()].sort((a, b) => a - b);

  const ranges: Array<{ from: number; to: number }> = [];
  for (const index of indexes) {
    const last = ranges[ranges.length - 1];
    if (last && index === last.to + 1) last.to = index;
    else ranges.push({ from: index, to: index });
  }

  try {
    await mkdir(dir, { recursive: true });
    const timeoutMs = Math.min(input.timeoutMs, 120_000);
    for (const range of ranges) {
      await runCommand(
        input.bins.pdftoppm,
        ['-gray', '-r', String(RASTER_DPI), '-f', String(range.from), '-l', String(range.to), input.inputPath, prefix],
        { timeoutMs, signal: input.signal },
      );
    }
    const files = (await readdir(dir)).filter((name) => /^page-\d+\.pgm$/.test(name));
    for (const name of files) {
      const index = Number.parseInt(name.replace(/^page-(\d+)\.pgm$/, '$1'), 10);
      const page = wanted.get(index);
      const path = join(dir, name);
      if (page) {
        try {
          const image = parsePgm(await readFile(path));
          if (image && image.width > 1 && image.height > 1) {
            const segments = rulesToSegments(rasterRules(image), page.width / image.width, page.height / image.height);
            if (segments.length > 0) result.set(index, segments);
          }
        } catch {
          // A single unreadable page must not lose the other pages.
        }
      }
      await unlink(path).catch(() => undefined);
    }
  } catch {
    return result;
  }
  return result;
}
