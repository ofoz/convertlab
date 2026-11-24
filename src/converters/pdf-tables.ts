import { randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ConversionError, type ConverterInput } from './types.ts';
import { runCommand } from './process.ts';
import { detectImageTableLines, type RasterPageRequest, type RasterSegment } from './pdf-image-tables.ts';

/**
 * Layout analysis for text-based PDFs.
 *
 * The text layer provides reliable word geometry. Borderless tables are rebuilt
 * from vertical whitespace channels; bordered tables are rebuilt from the line
 * artwork in a temporary SVG. For bordered tables this is important because
 * vertically offset text inside one cell must stay one cell, not become several
 * visual rows.
 */

type TableBounds = { x0: number; x1: number; y0: number; y1: number };

export type PdfTable = {
  rows: string[][];
  columnCount: number;
  columnWeights: number[];
  bounds?: TableBounds;
  merged?: boolean;
};

export type PdfBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'table'; rows: string[][]; columnWeights: number[] };

export type PdfPageLayout = {
  index: number;
  width: number;
  height: number;
  blocks: PdfBlock[];
  tables: PdfTable[];
  lines: string[];
  textLength: number;
  /** Tables that only the bitmap fallback could find (scanned pages). */
  imageTables?: number;
};

export type PdfLayout = {
  pages: PdfPageLayout[];
  hasText: boolean;
  tableCount: number;
  textLength: number;
  /** Tables rebuilt from page bitmaps, i.e. scanned tables with OCR text. */
  imageTables?: number;
};

type Word = { text: string; x0: number; y0: number; x1: number; y1: number };
type Row = { words: Word[]; y0: number; y1: number; yc: number };
type RawPage = { width: number; height: number; words: Word[] };
type Segment = { x0: number; y0: number; x1: number; y1: number };
type SvgPage = { segments: Segment[]; imageArea: number };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const CJK_BOUNDARY = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/;
const CJK_NO_SPACE_BEFORE = /[，。、；：！？：）】》”’…]/;
const CJK_NO_SPACE_AFTER = /[（【《“‘]/;

function decodeXml(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity] ?? match;
  });
}

function attrNumber(attrs: string, name: string): number {
  const match = new RegExp(`\\b${name}="(-?[0-9.]+)"`).exec(attrs);
  return match ? Number.parseFloat(match[1]!) : 0;
}

function attrString(attrs: string, name: string): string {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1] ?? '';
}

function parsePages(xhtml: string): RawPage[] {
  const pages: RawPage[] = [];
  const pagePattern = /<page\b([^>]*)>([\s\S]*?)<\/page>/g;
  let pageMatch: RegExpExecArray | null;
  while ((pageMatch = pagePattern.exec(xhtml))) {
    const attrs = pageMatch[1] ?? '';
    const body = pageMatch[2] ?? '';
    const words: Word[] = [];
    const wordPattern = /<word\b([^>]*)>([\s\S]*?)<\/word>/g;
    let wordMatch: RegExpExecArray | null;
    while ((wordMatch = wordPattern.exec(body))) {
      const wordAttrs = wordMatch[1] ?? '';
      const text = decodeXml((wordMatch[2] ?? '').replace(/<[^>]+>/g, '')).trim();
      if (!text) continue;
      const x0 = attrNumber(wordAttrs, 'xMin');
      const x1 = attrNumber(wordAttrs, 'xMax');
      const y0 = attrNumber(wordAttrs, 'yMin');
      const y1 = attrNumber(wordAttrs, 'yMax');
      if (!Number.isFinite(x0) || !Number.isFinite(x1) || x1 <= x0) continue;
      words.push({ text, x0, y0, x1, y1 });
    }
    pages.push({
      width: attrNumber(attrs, 'width') || 595,
      height: attrNumber(attrs, 'height') || 842,
      words,
    });
  }
  return pages;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Most frequent value after rounding to whole points, used as a body-size baseline. */
function mode(values: number[]): number {
  if (values.length === 0) return 0;
  const counts = new Map<number, number>();
  for (const value of values) {
    const key = Math.round(value * 2) / 2;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best = 0;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && value < best)) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function buildRows(words: Word[]): Row[] {
  if (words.length === 0) return [];
  const heights = words.map((word) => word.y1 - word.y0).filter((height) => height > 0.5);
  const tolerance = Math.max(2.2, median(heights) * 0.45);
  const ordered = [...words].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2 || a.x0 - b.x0);
  const rows: Row[] = [];
  for (const word of ordered) {
    const center = (word.y0 + word.y1) / 2;
    const last = rows[rows.length - 1];
    if (last && Math.abs(center - last.yc) <= tolerance) {
      last.words.push(word);
      last.y0 = Math.min(last.y0, word.y0);
      last.y1 = Math.max(last.y1, word.y1);
      last.yc = (last.y0 + last.y1) / 2;
    } else {
      rows.push({ words: [word], y0: word.y0, y1: word.y1, yc: center });
    }
  }
  for (const row of rows) row.words.sort((a, b) => a.x0 - b.x0);
  return rows;
}

function needsSpace(left: string, right: string): boolean {
  const before = left.at(-1);
  const after = right.at(0);
  if (!before || !after) return false;
  if (/\s/.test(before) || /\s/.test(after)) return false;
  if (CJK_BOUNDARY.test(before) || CJK_BOUNDARY.test(after)) return false;
  if (CJK_NO_SPACE_BEFORE.test(after) || CJK_NO_SPACE_AFTER.test(before)) return false;
  return true;
}

/** Joins words that share one visual line without manufacturing CJK spaces. */
function joinInline(words: Word[]): string {
  let out = '';
  let previous: Word | undefined;
  for (const word of [...words].sort((a, b) => a.x0 - b.x0)) {
    if (!previous) {
      out = word.text;
    } else {
      const gap = word.x0 - previous.x1;
      // pdftotext already split these words, which for Latin text almost always
      // means a real space. Only treat a hairline gap as a kerning artefact.
      const wideGap = gap > Math.max(0.8, (previous.y1 - previous.y0) * 0.06);
      const separator = wideGap && needsSpace(out, word.text) ? ' ' : '';
      out += separator + word.text;
    }
    previous = word;
  }
  return out.replace(/[ \t]+/g, ' ').trim();
}

function joinLines(lines: string[]): string {
  let out = '';
  for (const line of lines) {
    if (!line) continue;
    out = out ? out + (needsSpace(out, line) ? ' ' : '') + line : line;
  }
  return out.replace(/[ \t]+/g, ' ').trim();
}

function collapse(words: Word[]): string {
  return joinInline(words);
}

/** Groups multi-line text inside one table cell in reading order. */
function collapseCell(words: Word[]): string {
  return joinLines(buildRows(words).map((row) => joinInline(row.words)));
}

const SECTION_NUMBER = /^(?:第[一二三四五六七八九十百零\d]+[章节篇部分]|[一二三四五六七八九十]+、|\d+(?:\.\d+)+\s|[（(][一二三四五六七八九十]+[)）])/;
const TOC_SUFFIX = /(?:\.{3,}|…{2,})\s*\d+\s*$/;

/**
 * Section titles such as "四、我擅长什么" share the body font size, so geometry
 * alone is not enough. They are recognisable by their numbering prefix and by
 * the absence of a closing full stop.
 */
function looksLikeHeading(text: string): boolean {
  if (text.length > 40) return false;
  if (TOC_SUFFIX.test(text)) return false;
  if (/[。！？；]$/.test(text)) return false;
  return SECTION_NUMBER.test(text);
}

function isLikelyPageFooter(row: Row, pageHeight: number): boolean {
  if (row.y0 < pageHeight * 0.9) return false;
  const text = collapse(row.words);
  return /^\d{1,3}$/.test(text) || /^第\s*\d+\s*页(?:\s*[/／]\s*\d+)?$/.test(text);
}

type Run = { x0: number; x1: number; words: Word[] };

const KERN_GAP = 1.4;
const MAX_COLUMNS = 24;

function runsOf(row: Row, threshold: number): Run[] {
  const runs: Run[] = [];
  for (const word of row.words) {
    const last = runs[runs.length - 1];
    if (last && word.x0 - last.x1 < threshold) {
      last.x1 = Math.max(last.x1, word.x1);
      last.words.push(word);
    } else {
      runs.push({ x0: word.x0, x1: word.x1, words: [word] });
    }
  }
  return runs;
}

type Shape = { threshold: number; counts: number[]; coverage: number; columns: number };

/**
 * Word spacing inside one cell is smaller than the gutter between columns, but
 * "small" varies with the generator. Try every occurring gap and keep the
 * smallest threshold at which most rows agree on the same cell count.
 */
function chooseShape(rows: Row[], start: number, end: number): Shape | null {
  const indices: number[] = [];
  for (let index = start; index <= end; index += 1) indices.push(index);

  const gaps: number[] = [];
  for (const index of indices) {
    const runs = runsOf(rows[index]!, KERN_GAP);
    for (let position = 1; position < runs.length; position += 1) {
      const width = runs[position]!.x0 - runs[position - 1]!.x1;
      if (width >= KERN_GAP && width <= 90) gaps.push(width);
    }
  }
  const candidates = [...new Set(gaps)].sort((a, b) => a - b);

  let best: Shape | null = null;
  for (const threshold of candidates) {
    const counts = indices.map((index) => runsOf(rows[index]!, threshold).length);
    const multi = counts.filter((count) => count >= 2);
    if (multi.length === 0) continue;
    const frequency = new Map<number, number>();
    for (const count of multi) frequency.set(count, (frequency.get(count) ?? 0) + 1);
    let mode = 0;
    let modeCount = 0;
    for (const [count, seen] of frequency) {
      if (seen > modeCount || (seen === modeCount && count > mode)) {
        mode = count;
        modeCount = seen;
      }
    }
    if (mode < 2 || mode > MAX_COLUMNS || modeCount < 2) continue;
    const coverage = (modeCount + counts.filter((count) => count === 1).length) / counts.length;
    if (coverage < 0.6) continue;
    if (
      !best ||
      coverage > best.coverage + 1e-9 ||
      (Math.abs(coverage - best.coverage) <= 1e-9 && mode > best.columns)
    ) {
      best = { threshold, counts, coverage, columns: mode };
    }
  }
  return best;
}

type TextTableCandidate = {
  start: number;
  end: number;
  rows: string[][];
  weights: number[];
};

function columnOf(run: Run, boundaries: number[]): number {
  const center = (run.x0 + run.x1) / 2;
  const found = boundaries.findIndex((boundary) => center < boundary);
  return found === -1 ? boundaries.length : found;
}

function looksLikeTableOfContents(rows: string[][]): boolean {
  let entries = 0;
  for (const row of rows) {
    const text = row.join(' ');
    if (/(?:\.{3,}|…{2,})\s*\d+\s*$/.test(text)) entries += 1;
  }
  return entries >= 2;
}

function buildTextTable(rows: Row[], blockStart: number, blockEnd: number, shape: Shape): TextTableCandidate | null {
  const columns = shape.columns;
  if (columns < 2) return null;

  const runsAt = (index: number): Run[] => runsOf(rows[index]!, shape.threshold);
  let start = blockStart;
  while (start < blockEnd && runsAt(start).length < columns) start += 1;
  let end = blockEnd;
  while (end > start && runsAt(end).length < columns) end -= 1;
  if (end - start < 1) return null;

  const aligned: Run[][] = [];
  for (let index = start; index <= end; index += 1) {
    const runs = runsAt(index);
    if (runs.length === columns) aligned.push(runs);
  }
  if (aligned.length < 2) return null;

  const boundaries: number[] = [];
  for (let position = 1; position < columns; position += 1) {
    const midpoints = aligned.map((runs) => (runs[position - 1]!.x1 + runs[position]!.x0) / 2);
    boundaries.push(median(midpoints));
  }
  for (let position = 1; position < boundaries.length; position += 1) {
    if (boundaries[position]! <= boundaries[position - 1]!) boundaries[position] = boundaries[position - 1]! + 4;
  }

  const cells: string[][] = [];
  const rowBounds = Array.from({ length: columns }, () => ({ min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY }));

  for (let index = start; index <= end; index += 1) {
    const runs = runsAt(index);
    const buckets: Word[][] = Array.from({ length: columns }, () => []);
    if (runs.length === columns) {
      runs.forEach((run, position) => buckets[position]!.push(...run.words));
    } else {
      for (const run of runs) {
        for (const word of run.words) buckets[columnOf(run, boundaries)]!.push(word);
      }
    }
    for (let position = 0; position < columns; position += 1) {
      const inside = runs.filter((run) => columnOf(run, boundaries) === position);
      if (inside.length === 0) continue;
      rowBounds[position]!.min = Math.min(rowBounds[position]!.min, inside[0]!.x0);
      rowBounds[position]!.max = Math.max(rowBounds[position]!.max, inside[inside.length - 1]!.x1);
    }
    cells.push(buckets.map(collapseCell));
  }

  const used = Array.from({ length: columns }, (_, column) => cells.some((row) => (row[column] ?? '') !== ''));
  if (!used.some(Boolean)) return null;
  const keptColumns = used.map((value, column) => (value ? column : -1)).filter((column) => column >= 0);
  const kept = cells.map((row) => keptColumns.map((column) => row[column] ?? ''));

  while (kept.length > 0 && kept[0]!.filter((cell) => cell !== '').length < 2) kept.shift();
  while (kept.length > 0 && kept[kept.length - 1]!.filter((cell) => cell !== '').length < 2) kept.pop();
  if (kept.length < 2 || looksLikeTableOfContents(kept)) return null;

  const populated = kept.filter((row) => row.filter((cell) => cell !== '').length >= 2).length;
  const nonEmpty = kept.reduce((sum, row) => sum + row.filter((cell) => cell !== '').length, 0);
  if (populated < 2 || nonEmpty < 4) return null;

  // Centered display lines (cover title, date, version tag) also line up on
  // shared whitespace channels. A real borderless table needs at least three
  // rows and one edge that stays put, either left or right aligned.
  if (kept.length < 3) return null;
  const leftEdges: number[] = [];
  const rightEdges: number[] = [];
  for (let index = start; index <= end; index += 1) {
    const runs = runsAt(index);
    if (runs.length !== columns) continue;
    leftEdges.push(runs[0]!.x0);
    rightEdges.push(runs[runs.length - 1]!.x1);
  }
  const spread = (values: number[]): number =>
    (values.length >= 2 ? Math.max(...values) - Math.min(...values) : Number.POSITIVE_INFINITY);
  if (spread(leftEdges) > 6 && spread(rightEdges) > 6) return null;

  const weights = keptColumns.map((column, position) => {
    const left = position === 0
      ? (Number.isFinite(rowBounds[column]!.min) ? rowBounds[column]!.min - 4 : boundaries[0]! - 40)
      : boundaries[column - 1]!;
    const right = position === keptColumns.length - 1
      ? (Number.isFinite(rowBounds[column]!.max) ? rowBounds[column]!.max + 4 : boundaries[boundaries.length - 1]! + 40)
      : boundaries[column]!;
    return Math.max(10, Math.round(right - left));
  });

  return { start, end, rows: kept, weights };
}

function detectTextTables(rows: Row[]): TextTableCandidate[] {
  const candidates = rows.map((row) => runsOf(row, KERN_GAP).length >= 2);
  const tables: TextTableCandidate[] = [];
  let index = 0;
  while (index < rows.length) {
    if (!candidates[index]) {
      index += 1;
      continue;
    }
    let end = index;
    while (end + 1 < rows.length && candidates[end + 1]) {
      const previous = rows[end]!;
      const next = rows[end + 1]!;
      const gapLimit = Math.max(60, (previous.y1 - previous.y0) * 3.5, (next.y1 - next.y0) * 3.5);
      if (next.yc - previous.yc > gapLimit) break;
      end += 1;
    }

    if (end > index) {
      const shape = chooseShape(rows, index, end);
      if (shape) {
        const table = buildTextTable(rows, index, end, shape);
        if (table) {
          tables.push(table);
          index = table.end + 1;
          continue;
        }
      }
    }
    index = end + 1;
  }
  return tables;
}

/* -------------------------------------------------------------------------- */
/* SVG line extraction                                                        */
/* -------------------------------------------------------------------------- */

type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number };
const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/**
 * Older Poppler releases (for example 22.12, still shipped by Debian bookworm)
 * emit paint as an inline style such as style="stroke:rgb(...)", while newer
 * releases emit stroke="" and fill="" attributes. Read both forms so table
 * rules are not silently dropped depending on the container image.
 */
function paintValue(attrs: string, name: 'fill' | 'stroke'): string {
  const direct = attrString(attrs, name);
  if (direct) return direct;
  const style = attrString(attrs, 'style');
  if (!style) return '';
  for (const declaration of style.split(';')) {
    const separator = declaration.indexOf(':');
    if (separator === -1) continue;
    if (declaration.slice(0, separator).trim() === name) return declaration.slice(separator + 1).trim();
  }
  return '';
}

function parseTransform(value: string): Matrix {
  let result = { ...IDENTITY };
  const pattern = /(matrix|translate|scale)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    const values = (match[2] ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
    let next: Matrix = { ...IDENTITY };
    if (match[1] === 'matrix' && values.length >= 6) {
      next = { a: values[0]!, b: values[1]!, c: values[2]!, d: values[3]!, e: values[4]!, f: values[5]! };
    } else if (match[1] === 'translate' && values.length >= 1) {
      next = { ...IDENTITY, e: values[0]!, f: values[1] ?? 0 };
    } else if (match[1] === 'scale' && values.length >= 1) {
      next = { ...IDENTITY, a: values[0]!, d: values[1] ?? values[0]! };
    }
    // SVG lists transforms left-to-right; the right-most transform acts first.
    result = compose(next, result);
  }
  return result;
}

function compose(left: Matrix, right: Matrix): Matrix {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

function transformPoint(matrix: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: matrix.a * x + matrix.c * y + matrix.e, y: matrix.b * x + matrix.d * y + matrix.f };
}

function pathSegments(d: string): Array<{ x0: number; y0: number; x1: number; y1: number }> {
  const tokens = d.match(/[MLZmlz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const segments: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  let index = 0;
  let command = '';
  let first: { x: number; y: number } | null = null;
  let previous: { x: number; y: number } | null = null;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (/^[MLZmlz]$/.test(token)) {
      command = token.toUpperCase();
      index += 1;
      if (command === 'Z' && first && previous) {
        segments.push({ x0: previous.x, y0: previous.y, x1: first.x, y1: first.y });
        previous = first;
      }
      continue;
    }
    if (command !== 'M' && command !== 'L') {
      index += 1;
      continue;
    }
    const x = Number(tokens[index]);
    const y = Number(tokens[index + 1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) break;
    const point = { x, y };
    if (command === 'M') {
      first = point;
      previous = point;
      command = 'L';
    } else if (previous) {
      segments.push({ x0: previous.x, y0: previous.y, x1: point.x, y1: point.y });
      previous = point;
    }
    index += 2;
  }
  return segments;
}

/** Bitmap areas declared in the SVG, keyed by element id. */
function declaredImageAreas(svg: string): Map<string, number> {
  const sizes = new Map<string, number>();
  const pattern = /<image\b([^>]*)>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(svg))) {
    const attrs = match[1] ?? '';
    const id = attrString(attrs, 'id');
    const width = attrNumber(attrs, 'width');
    const height = attrNumber(attrs, 'height');
    if (id && width > 0 && height > 0) sizes.set(id, width * height);
  }
  return sizes;
}

/** Page area covered by bitmap content, which is how a scanned page shows up. */
function bodyImageArea(body: string, sizes: Map<string, number>): number {
  let area = 0;
  const usePattern = /<use\b([^>]*)>/g;
  let match: RegExpExecArray | null;
  while ((match = usePattern.exec(body))) {
    const attrs = match[1] ?? '';
    const href = attrString(attrs, 'href');
    const size = href.startsWith('#') ? sizes.get(href.slice(1)) : undefined;
    if (size === undefined) continue;
    const scale = parseTransform(attrString(attrs, 'transform'));
    area += size * Math.abs(scale.a * scale.d - scale.b * scale.c);
  }
  const inlinePattern = /<image\b([^>]*)>/g;
  while ((match = inlinePattern.exec(body))) {
    const attrs = match[1] ?? '';
    area += attrNumber(attrs, 'width') * attrNumber(attrs, 'height');
  }
  return area;
}

export function parseSvgPages(svg: string): SvgPage[] {
  const sizes = declaredImageAreas(svg);
  const withoutDefs = svg.replace(/<defs\b[\s\S]*?<\/defs>/g, '');
  const bodies: string[] = [];
  const pagePattern = /<page(?:\s[^>]*)?>([\s\S]*?)<\/page>/g;
  let pageMatch: RegExpExecArray | null;
  while ((pageMatch = pagePattern.exec(withoutDefs))) bodies.push(pageMatch[1] ?? '');
  if (bodies.length === 0) {
    // Poppler omits the <page> wrapper entirely when the PDF has one page.
    const body = withoutDefs.replace(/^[\s\S]*?<svg\b[^>]*>/, '').replace(/<\/svg>\s*$/, '');
    if (body.includes('<')) bodies.push(body);
  }

  const pages: SvgPage[] = [];
  for (const body of bodies) {
    const segments: Segment[] = [];
    const stack: Matrix[] = [{ ...IDENTITY }];
    const tagPattern = /<(\/?)g\b([^>]*)>|<path\b([^>]*?)\/?>/g;
    let tag: RegExpExecArray | null;
    while ((tag = tagPattern.exec(body))) {
      if (tag[0].startsWith('</g')) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      if (tag[0].startsWith('<g')) {
        const parent = stack[stack.length - 1]!;
        stack.push(compose(parent, parseTransform(attrString(tag[2] ?? '', 'transform'))));
        continue;
      }
      const attrs = tag[3] ?? '';
      const d = attrString(attrs, 'd');
      if (!d) continue;
      const matrix = compose(stack[stack.length - 1]!, parseTransform(attrString(attrs, 'transform')));
      const fill = paintValue(attrs, 'fill');
      const stroke = paintValue(attrs, 'stroke');
      const raw = pathSegments(d).map((segment) => {
        const start = transformPoint(matrix, segment.x0, segment.y0);
        const end = transformPoint(matrix, segment.x1, segment.y1);
        return { x0: start.x, y0: start.y, x1: end.x, y1: end.y };
      });

      if (stroke && stroke !== 'none') {
        segments.push(...raw);
        continue;
      }
      if (!fill || fill === 'none') continue;

      // Some generators paint rules as thin filled rectangles instead of strokes.
      const xs = raw.flatMap((segment) => [segment.x0, segment.x1]);
      const ys = raw.flatMap((segment) => [segment.y0, segment.y1]);
      if (xs.length === 0 || ys.length === 0) continue;
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs);
      const y0 = Math.min(...ys);
      const y1 = Math.max(...ys);
      if (y1 - y0 <= 1.5 && x1 - x0 >= 15) {
        const y = (y0 + y1) / 2;
        segments.push({ x0, y0: y, x1, y1: y });
      } else if (x1 - x0 <= 1.5 && y1 - y0 >= 6) {
        const x = (x0 + x1) / 2;
        segments.push({ x0: x, y0, x1: x, y1 });
      }
    }
    pages.push({ segments, imageArea: bodyImageArea(body, sizes) });
  }
  return pages;
}

type HLine = { y: number; x0: number; x1: number };
type VLine = { x: number; y0: number; y1: number };

type Axis = { start: number; end: number };

/** Groups values that are within `tolerance` of the group median. */
function clusterBy<T>(items: T[], valueOf: (item: T) => number, tolerance = 1.6): T[][] {
  const sorted = [...items].sort((a, b) => valueOf(a) - valueOf(b));
  const groups: T[][] = [];
  for (const item of sorted) {
    const group = groups[groups.length - 1];
    if (group && Math.abs(valueOf(item) - median(group.map(valueOf))) <= tolerance) group.push(item);
    else groups.push([item]);
  }
  return groups;
}

/**
 * Collinear rules on one page need not be one rule: the left border of three
 * stacked tables sits at the same x but is three separate strokes. Merging by
 * coordinate alone would fuse them into a single page-height border and swallow
 * the gaps between the tables, so collinear pieces are split again wherever the
 * stroke stops for more than `gap` points.
 */
function splitRuns<T>(items: T[], spanOf: (item: T) => Axis, gap = 3): T[][] {
  const sorted = [...items].sort((a, b) => spanOf(a).start - spanOf(b).start);
  const runs: T[][] = [];
  let end = Number.NEGATIVE_INFINITY;
  for (const item of sorted) {
    const span = spanOf(item);
    const run = runs[runs.length - 1];
    if (run && span.start - end <= gap) {
      run.push(item);
      end = Math.max(end, span.end);
    } else {
      runs.push([item]);
      end = span.end;
    }
  }
  return runs;
}

function clusterH(lines: HLine[]): HLine[] {
  const result: HLine[] = [];
  for (const group of clusterBy(lines, (line) => line.y)) {
    const y = median(group.map((line) => line.y));
    for (const run of splitRuns(group, (line) => ({ start: line.x0, end: line.x1 }))) {
      result.push({
        y,
        x0: Math.min(...run.map((line) => line.x0)),
        x1: Math.max(...run.map((line) => line.x1)),
      });
    }
  }
  return result;
}

function clusterV(lines: VLine[]): VLine[] {
  const result: VLine[] = [];
  for (const group of clusterBy(lines, (line) => line.x)) {
    const x = median(group.map((line) => line.x));
    for (const run of splitRuns(group, (line) => ({ start: line.y0, end: line.y1 }))) {
      result.push({
        x,
        y0: Math.min(...run.map((line) => line.y0)),
        y1: Math.max(...run.map((line) => line.y1)),
      });
    }
  }
  return result;
}

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function uniqueLevels(values: number[], tolerance = 2): number[] {
  const levels: number[] = [];
  for (const value of [...values].sort((a, b) => a - b)) {
    if (levels.length === 0 || Math.abs(value - levels[levels.length - 1]!) > tolerance) levels.push(value);
  }
  return levels;
}

type GridCandidate = {
  xLevels: number[];
  yLevels: number[];
  rows: string[][];
  weights: number[];
  bounds: TableBounds;
};

function extractGrid(
  xLevels: number[],
  yLevels: number[],
  words: Word[],
): { rows: string[][]; weights: number[] } | null {
  if (xLevels.length < 3 || yLevels.length < 3) return null;
  const columns = xLevels.length - 1;
  const rowCount = yLevels.length - 1;
  const cells: Word[][][] = Array.from({ length: rowCount }, () =>
    Array.from({ length: columns }, () => [] as Word[]));

  for (const word of words) {
    const xc = (word.x0 + word.x1) / 2;
    const yc = (word.y0 + word.y1) / 2;
    if (xc < xLevels[0]! - 1 || xc > xLevels[xLevels.length - 1]! + 1) continue;
    if (yc < yLevels[0]! - 1 || yc > yLevels[yLevels.length - 1]! + 1) continue;
    const row = yLevels.findIndex((level, index) => index < yLevels.length - 1 && yc >= level && yc < yLevels[index + 1]!);
    const col = xLevels.findIndex((level, index) => index < xLevels.length - 1 && xc >= level && xc < xLevels[index + 1]!);
    if (row >= 0 && col >= 0) cells[row]![col]!.push(word);
  }

  const rows = cells.map((row) => row.map(collapseCell));
  const populated = rows.filter((row) => row.some((cell) => cell !== '')).length;
  const nonEmpty = rows.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
  if (populated < 2 || nonEmpty < 4) return null;
  return { rows, weights: xLevels.slice(1).map((level, index) => Math.max(10, Math.round(level - xLevels[index]!))) };
}

export function detectGridTables(segments: Segment[], words: Word[]): GridCandidate[] {
  const horizontal: HLine[] = [];
  const vertical: VLine[] = [];
  for (const segment of segments) {
    const dx = Math.abs(segment.x1 - segment.x0);
    const dy = Math.abs(segment.y1 - segment.y0);
    if (dy <= 0.8 && dx >= 15) {
      horizontal.push({ y: (segment.y0 + segment.y1) / 2, x0: Math.min(segment.x0, segment.x1), x1: Math.max(segment.x0, segment.x1) });
    } else if (dx <= 0.8 && dy >= 6) {
      vertical.push({ x: (segment.x0 + segment.x1) / 2, y0: Math.min(segment.y0, segment.y1), y1: Math.max(segment.y0, segment.y1) });
    }
  }

  const hs = clusterH(horizontal);
  const vs = clusterV(vertical);
  if (hs.length < 3 || vs.length < 3) return [];

  /**
   * A table body is exactly the vertical span where at least three column rules
   * overlap. Two stacked tables never share a column rule, so a table can no
   * longer swallow the text or the header of the table below it.
   */
  const edges: Array<{ y: number; delta: number }> = [];
  for (const line of vs) {
    edges.push({ y: line.y0, delta: 1 });
    edges.push({ y: line.y1, delta: -1 });
  }
  edges.sort((a, b) => a.y - b.y || b.delta - a.delta);
  const spans: Array<{ y0: number; y1: number }> = [];
  let active = 0;
  let spanStart: number | null = null;
  for (const edge of edges) {
    active += edge.delta;
    if (active >= 3 && spanStart === null) spanStart = edge.y;
    if (active < 3 && spanStart !== null) {
      spans.push({ y0: spanStart, y1: edge.y });
      spanStart = null;
    }
  }
  const mergedSpans: Array<{ y0: number; y1: number }> = [];
  for (const span of spans) {
    if (span.y1 - span.y0 < 2) continue;
    const last = mergedSpans[mergedSpans.length - 1];
    if (last && span.y0 - last.y1 <= 2) last.y1 = Math.max(last.y1, span.y1);
    else mergedSpans.push({ ...span });
  }

  const candidates: Array<GridCandidate & { area: number }> = [];
  for (const span of mergedSpans) {
    const height = span.y1 - span.y0;
    if (height < 20) continue;
    const columns = vs.filter((line) => overlap(line.y0, line.y1, span.y0, span.y1) >= height * 0.7);
    if (columns.length < 3) continue;
    const x0 = Math.min(...columns.map((line) => line.x));
    const x1 = Math.max(...columns.map((line) => line.x));
    if (x1 - x0 < 40) continue;

    const rules = hs.filter((line) => {
      if (line.y < span.y0 - 2.5 || line.y > span.y1 + 2.5) return false;
      return overlap(line.x0, line.x1, x0, x1) >= (x1 - x0) * 0.7;
    });
    const yLevels = uniqueLevels([span.y0, ...rules.map((line) => line.y), span.y1]);
    if (yLevels.length < 3) continue;
    const xLevels = uniqueLevels([x0, ...columns.map((line) => line.x), x1]);
    if (xLevels.length < 3) continue;

    const extracted = extractGrid(xLevels, yLevels, words);
    if (!extracted) continue;
    candidates.push({
      xLevels,
      yLevels,
      rows: extracted.rows,
      weights: extracted.weights,
      bounds: { x0: xLevels[0]!, x1: xLevels[xLevels.length - 1]!, y0: yLevels[0]!, y1: yLevels[yLevels.length - 1]! },
      area: (x1 - x0) * height,
    });
  }

  const accepted: Array<GridCandidate & { area: number }> = [];
  candidates.sort((a, b) => b.area - a.area);
  for (const candidate of candidates) {
    if (accepted.some((existing) => overlap(candidate.bounds.y0, candidate.bounds.y1, existing.bounds.y0, existing.bounds.y1) > 3)) continue;
    accepted.push(candidate);
  }
  accepted.sort((a, b) => a.bounds.y0 - b.bounds.y0);
  return accepted.map(({ area: _area, ...table }) => table);
}

/* -------------------------------------------------------------------------- */
/* Page assembly                                                              */
/* -------------------------------------------------------------------------- */

function wordInsideBounds(word: Word, bounds: TableBounds): boolean {
  const xc = (word.x0 + word.x1) / 2;
  const yc = (word.y0 + word.y1) / 2;
  return xc >= bounds.x0 - 1 && xc <= bounds.x1 + 1 && yc >= bounds.y0 - 1 && yc <= bounds.y1 + 1;
}

function longRuleCount(segments: Segment[]): { horizontal: number; vertical: number } {
  let horizontal = 0;
  let vertical = 0;
  for (const segment of segments) {
    const dx = Math.abs(segment.x1 - segment.x0);
    const dy = Math.abs(segment.y1 - segment.y0);
    if (dy <= 0.8 && dx >= 15) horizontal += 1;
    else if (dx <= 0.8 && dy >= 6) vertical += 1;
  }
  return { horizontal, vertical };
}

function pageLayout(
  raw: RawPage,
  pageIndex: number,
  svgPage?: SvgPage,
  rasterSegments?: Segment[],
): PdfPageLayout {
  const allRows = buildRows(raw.words);
  const vectorTables = svgPage ? detectGridTables(svgPage.segments, raw.words) : [];
  // Scanned pages carry no vector rules; their borders come from the bitmap.
  // Only grids the vector pass missed are kept, so a page that mixes real line
  // art with a background scan is not counted twice.
  const imageTables: GridCandidate[] = [];
  if (rasterSegments && rasterSegments.length > 0) {
    const merged = detectGridTables([...(svgPage?.segments ?? []), ...rasterSegments], raw.words);
    for (const table of merged) {
      const duplicate = vectorTables.some(
        (existing) => overlap(existing.bounds.y0, existing.bounds.y1, table.bounds.y0, table.bounds.y1) > 3,
      );
      if (!duplicate) imageTables.push(table);
    }
  }
  const gridTables = [...imageTables, ...vectorTables].sort((a, b) => a.bounds.y0 - b.bounds.y0);
  const tableWords = new Set<Word>();
  for (const word of raw.words) {
    if (gridTables.some((table) => wordInsideBounds(word, table.bounds))) tableWords.add(word);
  }
  const externalWords = raw.words.filter((word) => !tableWords.has(word));
  const rows = buildRows(externalWords).filter((row) => !isLikelyPageFooter(row, raw.height));
  const textTables = detectTextTables(rows);

  const tableStarts = new Set(textTables.map((table) => table.start));
  const textTableRows = new Set<number>();
  for (const table of textTables) {
    for (let index = table.start; index <= table.end; index += 1) textTableRows.add(index);
  }

  const heights: number[] = [];
  for (const row of rows) {
    for (const word of row.words) {
      const height = word.y1 - word.y0;
      if (height > 0.5) heights.push(height);
    }
  }
  // A page can hold only a handful of body lines, so the median height is a
  // poor baseline. Compare against the most common height instead.
  const baseHeight = mode(heights) || median(heights) || 10;

  type Item = { y: number; order: number; block: PdfBlock };
  const items: Item[] = [];
  for (const table of gridTables) {
    items.push({
      y: table.bounds.y0,
      order: 0,
      block: { type: 'table', rows: table.rows, columnWeights: table.weights },
    });
  }
  for (let index = 0; index < rows.length; index += 1) {
    if (textTableRows.has(index)) {
      const table = textTables.find((candidate) => candidate.start === index);
      if (table) {
        items.push({
          y: rows[index]!.y0,
          order: 1,
          block: { type: 'table', rows: table.rows, columnWeights: table.weights },
        });
      }
      continue;
    }
    const row = rows[index]!;
    const text = collapse(row.words);
    if (!text) continue;
    const big = row.y1 - row.y0 >= baseHeight * 1.3;
    const heading = (big && text.length <= 80) || looksLikeHeading(text);
    items.push({ y: row.y0, order: 2, block: heading ? { type: 'heading', text } : { type: 'paragraph', text } });
  }
  items.sort((a, b) => a.y - b.y || a.order - b.order || a.block.type.localeCompare(b.block.type));
  const blocks = items.map((item) => item.block);

  const lines = allRows.map((row) => collapse(row.words)).filter((line) => line.length > 0);
  const textLength = lines.reduce((sum, line) => sum + line.replace(/\s/g, '').length, 0);
  const tables: PdfTable[] = [
    ...gridTables.map((table) => ({
      rows: table.rows,
      columnCount: table.rows[0]?.length ?? 0,
      columnWeights: table.weights,
      bounds: table.bounds,
    })),
    ...textTables.map((table) => ({
      rows: table.rows,
      columnCount: table.rows[0]?.length ?? 0,
      columnWeights: table.weights,
    })),
  ];

  return {
    index: pageIndex + 1,
    width: raw.width,
    height: raw.height,
    blocks,
    tables,
    lines,
    textLength,
    imageTables: imageTables.length,
  };
}

function normalizedRow(row: string[] | undefined): string {
  return (row ?? []).map((cell) => cell.replace(/\s+/g, '')).join('\u0000');
}

function sameColumnWidths(left: number[], right: number[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((width, index) => {
    const other = right[index]!;
    return Math.abs(width - other) <= Math.max(6, Math.max(width, other) * 0.12);
  });
}

function mergeCrossPageTables(pages: PdfPageLayout[]): void {
  for (let index = 1; index < pages.length; index += 1) {
    const previous = pages[index - 1]!;
    const current = pages[index]!;
    const previousTable = [...previous.tables].reverse().find((table) => !table.merged);
    const currentTable = current.tables.find((table) => !table.merged);
    if (!previousTable?.bounds || !currentTable?.bounds) continue;
    // A table that truly continues on the next page ends at the bottom of one
    // page and resumes at the very top of the next, with the same column grid.
    if (previousTable.bounds.y1 < previous.height * 0.8) continue;
    if (currentTable.bounds.y0 > current.height * 0.15) continue;
    if (previousTable.columnCount !== currentTable.columnCount) continue;
    if (!sameColumnWidths(previousTable.columnWeights, currentTable.columnWeights)) continue;
    const xShift = Math.max(
      Math.abs(previousTable.bounds.x0 - currentTable.bounds.x0),
      Math.abs(previousTable.bounds.x1 - currentTable.bounds.x1),
    );
    if (xShift > 8) continue;

    const repeatedHeader = normalizedRow(previousTable.rows[0]) === normalizedRow(currentTable.rows[0]);
    previousTable.rows.push(...currentTable.rows.slice(repeatedHeader ? 1 : 0));
    currentTable.merged = true;

    const previousBlock = [...previous.blocks].reverse().find((block) => block.type === 'table');
    if (previousBlock?.type === 'table') {
      previousBlock.rows = previousTable.rows;
      previousBlock.columnWeights = previousTable.columnWeights;
    }
    const firstTable = current.blocks.findIndex((block) => block.type === 'table');
    if (firstTable >= 0) current.blocks.splice(firstTable, 1);
  }
}

export type AnalyzeOptions = {
  /** Analyse every page bitmap even when vector line art exists (tests, diagnostics). */
  forceRaster?: boolean;
};

/** Raster rendering is slow; only the first few pages of a scan are rebuilt. */
const RASTER_PAGE_LIMIT = 20;

/**
 * Picks the pages whose table borders must come from the bitmap.
 *
 * A page qualifies when it has text (so cells can be filled) but is painted as
 * a page-sized bitmap without usable vector rules — exactly what a scanned page
 * looks like after OCR. Born-digital pages never pay for the extra render.
 */
async function rasterSegmentsFor(
  input: ConverterInput,
  rawPages: RawPage[],
  svgPages: SvgPage[],
  force: boolean,
): Promise<Map<number, Segment[]>> {
  const requests: RasterPageRequest[] = [];
  for (let index = 0; index < rawPages.length && requests.length < RASTER_PAGE_LIMIT; index += 1) {
    const raw = rawPages[index]!;
    if (raw.words.length === 0) continue;
    const svgPage = svgPages[index];
    if (!force) {
      if (!svgPage) continue;
      const pageArea = Math.max(1, raw.width * raw.height);
      if (svgPage.imageArea < pageArea * 0.5) continue;
      const rules = longRuleCount(svgPage.segments);
      if (rules.horizontal >= 3 && rules.vertical >= 3) continue;
    }
    requests.push({ index: index + 1, width: raw.width, height: raw.height });
  }
  if (requests.length === 0) return new Map<number, Segment[]>();
  try {
    return await detectImageTableLines(input, requests);
  } catch {
    return new Map<number, Segment[]>();
  }
}

/** Extracts the full text layer and reconstructs tables from text or line art. */
export async function analyzePdfLayout(
  input: ConverterInput,
  options: AnalyzeOptions = {},
): Promise<PdfLayout> {
  const token = `${process.pid}-${randomUUID()}`;
  const textPath = join(input.workDir, `pdf-layout-${token}.xhtml`);
  const svgPath = join(input.workDir, `pdf-lines-${token}.svg`);
  let xhtml = '';
  let svg = '';

  try {
    try {
      await runCommand(input.bins.pdftotext, ['-bbox-layout', input.inputPath, textPath], {
        timeoutMs: Math.min(input.timeoutMs, 180_000),
        signal: input.signal,
      });
      xhtml = await readFile(textPath, 'utf8');
    } catch (error) {
      throw new ConversionError(`无法读取 PDF 文本层，文件可能已加密或损坏${error instanceof Error ? `：${error.message}` : ''}`);
    }

    // Line art is an enhancement. A damaged or unusual SVG must not prevent the
    // text-based fallback from producing a usable document.
    try {
      await runCommand(input.bins.pdftocairo, ['-svg', input.inputPath, svgPath], {
        timeoutMs: Math.min(input.timeoutMs, 180_000),
        signal: input.signal,
      });
      svg = await readFile(svgPath, 'utf8');
    } catch {
      svg = '';
    }
  } finally {
    await Promise.all([unlink(textPath).catch(() => undefined), unlink(svgPath).catch(() => undefined)]);
  }

  const rawPages = parsePages(xhtml).slice(0, 200);
  if (rawPages.length === 0) {
    return { pages: [], hasText: false, tableCount: 0, textLength: 0, imageTables: 0 };
  }
  const svgPages = svg ? parseSvgPages(svg) : [];
  const rasterSegments = await rasterSegmentsFor(input, rawPages, svgPages, options.forceRaster === true);
  const pages = rawPages.map((page, index) => pageLayout(page, index, svgPages[index], rasterSegments.get(index + 1)));
  mergeCrossPageTables(pages);
  const textLength = pages.reduce((sum, page) => sum + page.textLength, 0);
  const tableCount = pages.reduce((sum, page) => sum + page.tables.filter((table) => !table.merged).length, 0);
  const imageTables = pages.reduce((sum, page) => sum + (page.imageTables ?? 0), 0);
  return { pages, hasText: textLength > 0, tableCount, textLength, imageTables };
}

