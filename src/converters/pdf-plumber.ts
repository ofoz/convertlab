import { runCommand } from './process.ts';
import type { ConverterInput } from './types.ts';
import type { PdfCell } from './pdf-tables.ts';

/**
 * A second, independent born-digital table detector.
 *
 * The primary detector walks Poppler's SVG line art. This process instead asks
 * pdfplumber to inspect the PDF content stream. Running two readers matters
 * because Poppler and pdfplumber fail in different ways on generators that use
 * clipped rules, rotated coordinate systems or unusual cell painting.
 *
 * Everything is optional and best effort. A missing Python interpreter or
 * package produces an empty result; conversion continues with the first
 * detector. A conservative fusing layer in `pdf-tables.ts` decides whether the
 * second result is safe enough to improve the primary output.
 */

export type ExternalTableCell = {
  row: number;
  column: number;
  rowSpan: number;
  columnSpan: number;
  text?: string;
};

export type ExternalTable = {
  pageIndex: number;
  bounds: { x0: number; y0: number; x1: number; y1: number };
  columnCount: number;
  rowCount: number;
  rows: string[][];
  columnWeights: number[];
  cells: ExternalTableCell[];
};

const PLUMBER_MAX_PAGES = 30;
const PLUMBER_TIMEOUT_MS = 45_000;

const PYTHON_PROGRAM = `
import json
import sys

try:
    import pdfplumber
except Exception as exc:
    print(json.dumps({"tables": [], "reason": "pdfplumber not installed"}))
    sys.exit(0)

path = sys.argv[1]
result = {"tables": [], "reason": None}
try:
    with pdfplumber.open(path) as pdf:
        for page_number, page in enumerate(pdf.pages, 1):
            if page_number > int(sys.argv[2]):
                break
            for item in page.find_tables():
                bbox = item.bbox
                # pdfplumber y grows downwards in the rendered page, so no flip
                # is needed when mapping against pdftotext geometry.
                cells = {}
                # item.cells is required here: item.rows expands merged cells
                # into per-column fragments and loses their original spans.
                for cell in item.cells:
                    if not cell:
                        continue
                    x0, top, x1, bottom = cell
                    text = page.crop((x0, top, x1, bottom)).extract_text() or ""
                    key = (round(x0, 3), round(top, 3), round(x1, 3), round(bottom, 3))
                    cells.setdefault(key, text.strip())
                edges_x, edges_y = set(), set()
                for (x0, top, x1, bottom) in cells:
                    edges_x.update((x0, x1))
                    edges_y.update((top, bottom))
                xs = sorted(edges_x)
                ys = sorted(edges_y)
                # Merge coordinates within 1.5pt so hairline gaps do not create
                # duplicate logical columns.
                def levels(values):
                    out = []
                    for value in values:
                        if not out or value - out[-1] > 1.5:
                            out.append(value)
                        else:
                            out[-1] = (out[-1] + value) / 2
                    return out
                xs = levels(xs)
                ys = levels(ys)
                spans = []
                for (x0, top, x1, bottom), text in cells.items():
                    column = min(range(len(xs) - 1), key=lambda i: abs(xs[i] - x0))
                    end_column = max(range(1, len(xs)), key=lambda i: abs(xs[i] - x1))
                    row = min(range(len(ys) - 1), key=lambda i: abs(ys[i] - top))
                    end_row = max(range(1, len(ys)), key=lambda i: abs(ys[i] - bottom))
                    spans.append({
                        "row": row,
                        "column": column,
                        "rowSpan": max(1, end_row - row),
                        "columnSpan": max(1, end_column - column),
                        "text": text,
                    })
                column_count = max(1, len(xs) - 1)
                row_count = max(1, len(ys) - 1)
                rows = [["" for _ in range(column_count)] for _ in range(row_count)]
                for span in spans:
                    rows[span["row"]][span["column"]] = span["text"] or ""
                weights = [max(10, round(xs[i + 1] - xs[i])) for i in range(column_count)]
                result["tables"].append({
                    "pageIndex": page_number,
                    "bounds": {"x0": bbox[0], "y0": bbox[1], "x1": bbox[2], "y1": bbox[3]},
                    "rowCount": row_count,
                    "columnCount": column_count,
                    "rows": rows,
                    "columnWeights": weights,
                    "cells": spans,
                })
except Exception as exc:
    result["reason"] = str(exc)
print(json.dumps(result))
`;

function nonEmpty(value: string): number {
  return value.replace(/\s/g, '').length;
}

function completeScore(rows: string[][]): number {
  return rows.reduce((sum, row) => sum + row.reduce((total, cell) => total + nonEmpty(String(cell)), 0), 0);
}

/** Parses the best-effort JSON emitted by the helper process. */
export async function detectExternalPdfTables(input: ConverterInput): Promise<ExternalTable[]> {
  try {
    const output = await runCommand(
      process.env.PYTHON_TABLE_BIN || 'python3',
      ['-c', PYTHON_PROGRAM, input.inputPath, String(PLUMBER_MAX_PAGES)],
      { timeoutMs: Math.min(input.timeoutMs, PLUMBER_TIMEOUT_MS), signal: input.signal },
    );
    const parsed = JSON.parse(output.stdout) as { tables?: ExternalTable[]; reason?: string };
    if (!Array.isArray(parsed.tables)) return [];
    return parsed.tables
      .filter((table) => table.pageIndex >= 1 && Array.isArray(table.rows) && table.columnCount > 0)
      .slice(0, 240);
  } catch {
    return [];
  } finally {
  }
}

/** Normalizes pdfplumber's logical cells into the shared PDF cell shape. */
function sharedCells(table: ExternalTable): PdfCell[] {
  const rowCount = Math.max(table.rowCount, table.rows.length);
  const columnCount = Math.max(table.columnCount, ...table.rows.map((row) => row.length), 0);
  const occupied = Array.from({ length: rowCount }, () => Array.from({ length: columnCount }, () => false));
  const cells: PdfCell[] = [];
  for (const cell of table.cells) {
    if (!cell || cell.row < 0 || cell.column < 0 || cell.row >= rowCount || cell.column >= columnCount) continue;
    const rowSpan = Math.max(1, Math.min(cell.rowSpan, rowCount - cell.row));
    const columnSpan = Math.max(1, Math.min(cell.columnSpan, columnCount - cell.column));
    const text = String(cell.text ?? '');
    if (occupied[cell.row]![cell.column]) continue;
    for (let row = cell.row; row < cell.row + rowSpan; row += 1) {
      for (let column = cell.column; column < cell.column + columnSpan; column += 1) occupied[row]![column] = true;
    }
    cells.push({ row: cell.row, column: cell.column, rowSpan, columnSpan, text, verticalContinuation: false });
    for (let offset = 1; offset < rowSpan; offset += 1) {
      cells.push({
        row: cell.row + offset,
        column: cell.column,
        rowSpan: 1,
        columnSpan,
        text: '',
        verticalContinuation: true,
      });
    }
  }
  // Fill ordinary uncovered grid cells so DOCX/XLSX keep their original shape.
  for (let row = 0; row < rowCount; row += 1) {
    for (let column = 0; column < columnCount; column += 1) {
      if (!occupied[row]![column]) {
        cells.push({ row, column, rowSpan: 1, columnSpan: 1, text: table.rows[row]?.[column] ?? '', verticalContinuation: false });
      }
    }
  }
  return cells;
}

export function fuseExternalTables<T extends {
  rows: string[][];
  columnWeights: number[];
  bounds?: { x0: number; y0: number; x1: number; y1: number };
  columnCount?: number;
  cells?: PdfCell[];
}>(tables: T[], external: ExternalTable[], pageIndex: number): T[] {
  const unmatched = [...external];
  const replaced = tables.map((table) => {
    const bounds = table.bounds;
    if (!bounds) return table;
    const matches = external.filter((candidate) => {
      if (candidate.pageIndex !== pageIndex) return false;
      const xOverlap = Math.max(0, Math.min(bounds.x1, candidate.bounds.x1) - Math.max(bounds.x0, candidate.bounds.x0));
      const yOverlap = Math.max(0, Math.min(bounds.y1, candidate.bounds.y1) - Math.max(bounds.y0, candidate.bounds.y0));
      const ySource = Math.max(1, bounds.y1 - bounds.y0);
      const xSource = Math.max(1, bounds.x1 - bounds.x0);
      return yOverlap >= ySource * 0.7 && xOverlap >= xSource * 0.7;
    }).sort((left, right) => (right.rowCount * right.columnCount) - (left.rowCount * left.columnCount));
    const match = matches[0];
    if (!match || match.columnCount !== table.columnCount) return table;
    const rowDelta = Math.abs(match.rowCount - table.rows.length);
    const rowLimit = Math.max(2, Math.round(table.rows.length * 0.25));
    if (rowDelta > rowLimit) return table;

    const oldScore = completeScore(table.rows);
    const newScore = completeScore(match.rows);
    const materiallyBetter = newScore > oldScore * 1.1;
    const hasStructure = match.cells.some((cell) => cell.rowSpan > 1 || cell.columnSpan > 1);
    if (!materiallyBetter && !hasStructure) return table;
    const index = unmatched.indexOf(match);
    if (index >= 0) unmatched.splice(index, 1);
    return { ...table, rows: match.rows, columnWeights: match.columnWeights, cells: sharedCells(match) };
  });

  // The second detector is most valuable when the first detector missed a
  // complete table. Accept only structurally complete, non-trivial candidates,
  // and let overlap rejection above protect existing output.
  const additions = unmatched
    .filter((candidate) =>
      candidate.pageIndex === pageIndex &&
      candidate.rowCount >= 2 &&
      candidate.columnCount >= 2 &&
      completeScore(candidate.rows) >= 20 &&
      candidate.cells.length >= candidate.rowCount * candidate.columnCount * 0.5,
    )
    .map((candidate) => ({
      rows: candidate.rows,
      columnCount: candidate.columnCount,
      columnWeights: candidate.columnWeights,
      bounds: candidate.bounds,
      cells: sharedCells(candidate),
    } as unknown as T));

  return [...replaced, ...additions].sort((left, right) => (left.bounds?.y0 ?? 0) - (right.bounds?.y0 ?? 0));
}
