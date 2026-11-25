import { mkdir, readdir, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { runCommand } from './process.ts';
import type { ConverterInput } from './types.ts';
import type { PdfCell, PdfTable } from './pdf-tables.ts';

/**
 * Dedicated table-structure model for scanned pages.
 *
 * The pixel rule detector finds borders from a raster image, but faint,
 * broken or shadowed lines remain hard. RapidTable's SLANet Plus model infers
 * the logical grid directly from the image. We run it in an isolated Python
 * process, then fill its predicted cells with one Tesseract TSV pass per page.
 * Both model and OCR failures are best-effort: callers keep the existing
 * raster-grid result.
 */

export type RapidPageRequest = { index: number; width: number; height: number };
export type RapidTableResult = PdfTable & { page: number };
export type RapidPrediction = { pageIndex: number; imageWidth: number; imageHeight: number; logicPoints: number[][]; cellBboxes: number[][] };
export type RapidLogicPoint = [number, number, number, number];
type PageWord = { text: string; x0: number; y0: number; x1: number; y1: number };

const RAPID_MAX_PAGES = 20;
const RAPID_TIMEOUT_MS = 90_000;
const OCR_TIMEOUT_MS = 45_000;
const MIN_MODEL_ROWS = 2;
const MIN_MODEL_COLUMNS = 2;
const MIN_POPULATED_CELLS = 4;
const MIN_TEXT_CHARS = 8;
const MIN_WORD_CONFIDENCE = 55;

const PYTHON_PROGRAM = `
import json
import sys

try:
    from PIL import Image
    from rapid_table import ModelType, RapidTable, RapidTableInput
except Exception as exc:
    print(json.dumps({"tables": [], "reason": f"rapid-table unavailable: {exc}"}))
    sys.exit(0)

result = {"tables": [], "reason": None}
try:
    model = RapidTable(RapidTableInput(model_type=ModelType.SLANETPLUS, use_ocr=False))
    paths = sys.argv[1:]
    if paths:
        output = model(paths, batch_size=min(2, len(paths)))
        for index, logic_points in enumerate(output.logic_points):
            cell_bboxes = output.cell_bboxes[index] if index < len(output.cell_bboxes) else []
            with Image.open(paths[index]) as image:
                image_width, image_height = image.size
            result["tables"].append({
                "pageIndex": index + 1,
                "imageWidth": image_width,
                "imageHeight": image_height,
                "logicPoints": [[int(v) for v in point] for point in logic_points],
                "cellBboxes": [[float(v) for v in box] for box in cell_bboxes],
            })
except Exception as exc:
    result["reason"] = str(exc)
print(json.dumps(result))
`;

type TesseractWord = PageWord & { confidence: number };

export function parseTesseractTsv(tsv: string, scale: number): TesseractWord[] {
  const words: TesseractWord[] = [];
  for (const line of tsv.split(/\r?\n/).slice(1)) {
    const columns = line.split('\t');
    if (columns.length < 12) continue;
    const text = columns[11]?.trim();
    if (!text) continue;
    const confidence = Number.parseFloat(columns[10] ?? '');
    const left = Number.parseFloat(columns[6] ?? '');
    const top = Number.parseFloat(columns[7] ?? '');
    const width = Number.parseFloat(columns[8] ?? '');
    const height = Number.parseFloat(columns[9] ?? '');
    if (!Number.isFinite(confidence) || confidence < MIN_WORD_CONFIDENCE) continue;
    if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(width) || !Number.isFinite(height)) continue;
    if (width <= 0 || height <= 0) continue;
    words.push({
      text,
      x0: left * scale,
      y0: top * scale,
      x1: (left + width) * scale,
      y1: (top + height) * scale,
      confidence,
    });
  }
  return words;
}

function bboxToPointBox(cellBbox: number[], scaleX: number, scaleY: number) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let index = 0; index < cellBbox.length - 1; index += 2) {
    xs.push(cellBbox[index]! * scaleX);
    ys.push(cellBbox[index + 1]! * scaleY);
  }
  return {
    x0: Math.min(...xs),
    x1: Math.max(...xs),
    y0: Math.min(...ys),
    y1: Math.max(...ys),
  };
}

function inside(word: PageWord, bounds: { x0: number; y0: number; x1: number; y1: number }): boolean {
  const xc = (word.x0 + word.x1) / 2;
  const yc = (word.y0 + word.y1) / 2;
  return xc >= bounds.x0 - 2 && xc <= bounds.x1 + 2 && yc >= bounds.y0 - 2 && yc <= bounds.y1 + 2;
}

/** Builds logical cells and merged spans from RapidTable predictions. */
export function buildRapidTables(
  pages: RapidPageRequest[],
  predictions: RapidPrediction[],
  wordsByPage: Map<number, PageWord[]>,
): RapidTableResult[] {
  const results: RapidTableResult[] = [];
  for (const prediction of predictions) {
    const page = pages[prediction.pageIndex - 1];
    if (!page || prediction.cellBboxes.length === 0 || prediction.logicPoints.length !== prediction.cellBboxes.length) continue;
    const imageWidth = Math.max(1, prediction.imageWidth);
    const imageHeight = Math.max(1, prediction.imageHeight);
    const scaleX = page.width / imageWidth;
    const scaleY = page.height / imageHeight;
    const words = wordsByPage.get(page.index) ?? [];
    const rowCount = Math.max(...prediction.logicPoints.map((point) => Math.max(point[0]!, point[1]!) + 1), MIN_MODEL_ROWS);
    const columnCount = Math.max(...prediction.logicPoints.map((point) => Math.max(point[2]!, point[3]!) + 1), MIN_MODEL_COLUMNS);
    const occupied = Array.from({ length: rowCount }, () => Array.from({ length: columnCount }, () => false));
    const rows: string[][] = Array.from({ length: rowCount }, () => Array.from({ length: columnCount }, () => ''));
    const cells: PdfCell[] = [];
    const anchors: Array<{ row: number; column: number; rowSpan: number; columnSpan: number; bounds: { x0: number; y0: number; x1: number; y1: number } }> = [];

    prediction.logicPoints.forEach((logic, index) => {
      const rowStart = logic[0] ?? 0;
      const rowEnd = logic[1] ?? rowStart;
      const columnStart = logic[2] ?? 0;
      const columnEnd = logic[3] ?? columnStart;
      const row = Math.min(rowStart, rowEnd);
      const column = Math.min(columnStart, columnEnd);
      if (row < 0 || column < 0 || row >= rowCount || column >= columnCount || occupied[row]![column]) return;
      const rowSpan = Math.max(1, Math.min(Math.abs(rowEnd - rowStart) + 1, rowCount - row));
      const columnSpan = Math.max(1, Math.min(Math.abs(columnEnd - columnStart) + 1, columnCount - column));
      const bbox = prediction.cellBboxes[index] ?? [];
      const bounds = bboxToPointBox(bbox, scaleX, scaleY);
      if (!Number.isFinite(bounds.x0) || !Number.isFinite(bounds.y0) || bounds.x1 <= bounds.x0 || bounds.y1 <= bounds.y0) return;
      const text = words.filter((word) => inside(word, bounds)).map((word) => word.text).join(' ').trim();
      for (let r = row; r < row + rowSpan; r += 1) {
        for (let c = column; c < column + columnSpan; c += 1) occupied[r]![c] = true;
      }
      rows[row]![column] = text;
      cells.push({
        row,
        column,
        rowSpan,
        columnSpan,
        text,
        bounds,
        verticalContinuation: false,
      });
      for (let offset = 1; offset < rowSpan; offset += 1) {
        cells.push({
          row: row + offset,
          column,
          rowSpan: 1,
          columnSpan,
          text: '',
          verticalContinuation: true,
        });
      }
      anchors.push({ row, column, rowSpan, columnSpan, bounds });
    });

    const populated = rows.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
    const textChars = rows.reduce((sum, row) => sum + row.join('').replace(/\s/g, '').length, 0);
    const bounds = {
      x0: Math.min(...anchors.map((anchor) => anchor.bounds.x0)),
      x1: Math.max(...anchors.map((anchor) => anchor.bounds.x1)),
      y0: Math.min(...anchors.map((anchor) => anchor.bounds.y0)),
      y1: Math.max(...anchors.map((anchor) => anchor.bounds.y1)),
    };
    if (rowCount < MIN_MODEL_ROWS || columnCount < MIN_MODEL_COLUMNS || populated < MIN_POPULATED_CELLS || textChars < MIN_TEXT_CHARS || anchors.length === 0) continue;
    const weights = Array.from({ length: columnCount }, (_, column) => {
      const matched = anchors.filter((anchor) => anchor.column === column);
      if (matched.length === 0) return 60;
      const width = matched.reduce((sum, anchor) => sum + (anchor.bounds.x1 - anchor.bounds.x0) / anchor.columnSpan, 0) / matched.length;
      return Math.max(10, Math.round(width));
    });
    results.push({ page: page.index, rows, columnCount, columnWeights: weights, bounds, cells, merged: false });
  }
  return results;
}

async function ocrPage(input: ConverterInput, imagePath: string, scale: number): Promise<PageWord[]> {
  for (const langs of ['chi_sim+eng', 'eng']) {
    try {
      const result = await runCommand(
        input.bins.tesseract,
        [imagePath, 'stdout', '-l', langs, '--psm', '6', 'tsv'],
        { timeoutMs: Math.min(input.timeoutMs, OCR_TIMEOUT_MS), signal: input.signal },
      );
      const words = parseTesseractTsv(result.stdout, scale);
      if (words.length > 0) return words;
    } catch {
      // Try the reduced language set, then leave OCRmyPDF text unchanged.
    }
  }
  return [];
}

export async function detectRapidTables(input: ConverterInput, pages: RapidPageRequest[]): Promise<Map<number, RapidTableResult[]>> {
  const result = new Map<number, RapidTableResult[]>();
  if (pages.length === 0 || input.options.pdf?.ocr !== true) return result;
  const wanted = pages.slice(0, RAPID_MAX_PAGES);
  const token = `${process.pid}-rapid`;
  const dir = join(input.workDir, `rapid-${token}`);
  const prefix = join(dir, 'page');
  const predictions: RapidPrediction[] = [];
  const wordsByPage = new Map<number, PageWord[]>();

  try {
    await mkdir(dir, { recursive: true });
    await runCommand(
      input.bins.pdftoppm,
      [
        '-png', '-r', '300',
        '-f', String(Math.min(...wanted.map((page) => page.index))),
        '-l', String(Math.max(...wanted.map((page) => page.index))),
        input.inputPath, prefix,
      ],
      { timeoutMs: Math.min(input.timeoutMs, 120_000), signal: input.signal },
    );
    const names = (await readdir(dir)).filter((name) => /^page-\d+\.png$/.test(name)).sort();
    const pagePaths = wanted.map((page) => {
      const name = names.find((candidate) => candidate === `page-${page.index}.png`);
      return name ? join(dir, name) : null;
    });
    if (pagePaths.some((path) => path === null)) return result;
    const images = pagePaths.map((path) => path!);
    const modelOutput = await runCommand(process.env.PYTHON_TABLE_BIN || 'python3', ['-c', PYTHON_PROGRAM, ...images], {
      timeoutMs: Math.min(input.timeoutMs, RAPID_TIMEOUT_MS),
      signal: input.signal,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });
    const parsed = JSON.parse(modelOutput.stdout) as { tables?: RapidPrediction[]; reason?: string };
    if (!Array.isArray(parsed.tables)) return result;
    predictions.push(...parsed.tables);
    for (let index = 0; index < wanted.length; index += 1) {
      const page = wanted[index]!;
      const imagePath = images[index]!;
      // Tesseract coordinates use the same 300-dpi image, so derive the exact
      // point scale instead of assuming a perfect 300-dpi page.
      const prediction = predictions.find((item) => item.pageIndex === index + 1);
      const imageWidth = prediction?.imageWidth || page.width * 300 / 72;
      wordsByPage.set(page.index, await ocrPage(input, imagePath, page.width / imageWidth));
    }
    const tables = buildRapidTables(wanted, predictions, wordsByPage);
    for (const table of tables) {
      const list = result.get(table.page) ?? [];
      list.push(table);
      result.set(table.page, list);
    }
  } catch {
    return new Map<number, RapidTableResult[]>();
  } finally {
    const names = await readdir(dir).catch(() => []);
    await Promise.all(names.map((name) => unlink(join(dir, name)).catch(() => undefined)));
    await rm(dir, { force: true, recursive: true });
  }
  return result;
}

