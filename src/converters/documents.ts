import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import sharp from 'sharp';
import { runCommand } from './process.ts';
import { requireOutput, pageImages } from './image.ts';
import { ConversionError, type ConvertOutcome, type ConverterInput } from './types.ts';
import { buildDocxFromBlocks, buildDocxFromImages, buildPptxFromImages, buildPptxFromText, buildXlsx, displayWidth, type DocBlock, type SheetMerge, type SheetSpec, type SheetTableRange } from './ooxml.ts';
import { analyzePdfLayout, type PdfBlock, type PdfLayout } from './pdf-tables.ts';
import { ocrPdf } from './ocr.ts';
import { officeGroup } from './formats.ts';
import { buildZip } from './zip.ts';

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

function sofficeArgs(profile: string, args: string[]): string[] {
  return ['--headless', '--norestore', '--nolockcheck', `-env:UserInstallation=file://${profile}`, ...args];
}

async function findOutput(dir: string, preferredExt: string): Promise<string | null> {
  const entries = await readdir(dir, { withFileTypes: true });
  const candidates = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(`.${preferredExt.toLowerCase()}`)).map((entry) => join(dir, entry.name));
  return candidates.sort((a, b) => a.localeCompare(b))[0] ?? null;
}

export async function officeConvert(input: ConverterInput, inputPath = input.inputPath, inputFilter?: string): Promise<string> {
  const suffix = Math.random().toString(36).slice(2, 8);
  const outDir = join(input.workDir, `office-${suffix}`);
  await ensureDir(outDir);
  const args = sofficeArgs(join(input.workDir, `lo-profile-${suffix}`), [
    ...(inputFilter ? [`--infilter=${inputFilter}`] : []),
    '--convert-to',
    input.target,
    '--outdir',
    outDir,
    inputPath,
  ]);
  await runCommand(input.bins.soffice, args, {
    timeoutMs: input.timeoutMs,
    signal: input.signal,
    onStderr: (chunk) => {
      if (chunk.includes('convert ')) input.onProgress?.(55);
    },
  });
  const produced = await findOutput(outDir, input.target);
  if (!produced) throw new ConversionError('文档转换没有生成目标文件');
  await requireOutput(produced);
  return produced;
}

async function pdfPageCount(path: string, input: ConverterInput): Promise<number> {
  const result = await runCommand(input.bins.pdfinfo, [path], { timeoutMs: 20_000 });
  const match = result.stdout.match(/^Pages:\s+(\d+)/m);
  const pages = match ? Number.parseInt(match[1]!, 10) : 0;
  if (!pages) throw new ConversionError('无法读取 PDF 页数');
  return Math.min(pages, 200);
}

async function renderPdfPages(input: ConverterInput, format: 'jpg' | 'png', dpi: number): Promise<{ files: string[]; pages: Awaited<ReturnType<typeof pageImages>> }> {
  const renderDir = join(input.workDir, `pages-${format}`);
  await ensureDir(renderDir);
  const prefix = join(renderDir, 'page');
  await runCommand(input.bins.pdftoppm, [format === 'jpg' ? '-jpeg' : '-png', '-r', String(dpi), input.inputPath, prefix], {
    timeoutMs: input.timeoutMs,
    signal: input.signal,
  });
  const names = (await readdir(renderDir))
    .filter((name) => name.startsWith('page-') && name.endsWith(`.${format}`))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (names.length === 0) throw new ConversionError('无法将 PDF 页面渲染为图片');
  const files = names.map((name) => join(renderDir, name));
  input.onProgress?.(60);
  return { files, pages: await pageImages(files, format) };
}

export async function extractPdfImages(input: ConverterInput, format: 'jpg' | 'png', dpi = 150): Promise<{ files: string[]; outputPath: string; note: string }> {
  const { files } = await renderPdfPages(input, format, dpi);
  if (files.length === 1) {
    const out = join(input.outputDir, `${input.outputBase}.${format}`);
    await copyFile(files[0]!, out);
    return { files: [out], outputPath: out, note: '' };
  }
  const zipPath = join(input.outputDir, `${input.outputBase}-pages.zip`);
  const entries = await Promise.all(files.map(async (file) => ({ name: basename(file), data: await readFile(file) })));
  await writeFile(zipPath, buildZip(entries));
  await requireOutput(zipPath);
  return { files, outputPath: zipPath, note: `PDF 共 ${files.length} 页，已打包为 ZIP` };
}

async function pdfToText(path: string, input: ConverterInput): Promise<string> {
  const result = await runCommand(input.bins.pdftotext, ['-layout', path, '-'], { timeoutMs: input.timeoutMs, signal: input.signal });
  return result.stdout;
}

function splitPdfText(text: string): string[][] {
  return text
    .split(/\f/)
    .filter((page, index, all) => page.trim().length > 0 || index < all.length - 1)
    .map((page) => page.split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim().length > 0));
}

function sheetName(value: string, fallback: string): string {
  const cleaned = value.replace(/[\[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31);
  return cleaned || fallback;
}

export type ExcelSheetMode = 'single' | 'page';

export function workbookSheetName(layout: PdfLayout): string {
  const name = layout.pages[0]?.blocks.find((block) => block.type === 'heading' && block.text.trim());
  return sheetName(name?.type === 'heading' ? name.text : 'PDF 转换', 'PDF 转换');
}

/**
 * Places every paragraph and table from one PDF page on a shared grid.
 * Paragraphs span the full table width as merged cells; tables keep their
 * borders, header styling and numeric cells.
 */
export function blocksToSheet(blocks: PdfBlock[], name: string): SheetSpec {
  const rows: string[][] = [];
  const merges: SheetMerge[] = [];
  const tables: SheetTableRange[] = [];
  const tableRows: string[][] = [];
  const paragraphRows: number[] = [];
  const rowHeights = new Map<number, number>();
  let maxColumns = 1;

  for (const block of blocks) {
    if (block.type === 'table') {
      if (block.rows.length === 0) continue;
      maxColumns = Math.max(maxColumns, ...block.rows.map((row) => row.length));
      if (rows.length > 0 && rows[rows.length - 1]!.some((value) => value.trim().length > 0)) rows.push([]);
      const startRow = rows.length;
      rows.push(...block.rows);
      tableRows.push(...block.rows);
      tables.push({ startRow, endRow: rows.length - 1, headerRow: true });
      for (const cell of block.cells ?? []) {
        if ((cell.columnSpan ?? 1) < 2 && (cell.rowSpan ?? 1) < 2) continue;
        const endRow = startRow + cell.row + Math.max(1, cell.rowSpan ?? 1) - 1;
        const endColumn = cell.column + Math.max(1, cell.columnSpan ?? 1) - 1;
        if (endRow < startRow || endColumn >= maxColumns) continue;
        merges.push({ startRow: startRow + cell.row, endRow, startColumn: cell.column, endColumn });
      }
      rows.push([]);
      continue;
    }
    const text = block.text.trim();
    if (!text) {
      if (rows.length > 0 && rows[rows.length - 1]!.some((value) => value.trim() !== '')) rows.push([]);
      continue;
    }
    paragraphRows.push(rows.length);
    rowHeights.set(rows.length, 15);
    rows.push([text]);
  }

  while (rows.length > 0 && rows[rows.length - 1]!.every((value) => value.trim() === '')) rows.pop();
  const paragraphMerge = maxColumns > 1
    ? paragraphRows
      .filter((row) => row < rows.length)
      .map((row) => ({ startRow: row, endRow: row, startColumn: 0, endColumn: maxColumns - 1 }))
    : [];
  merges.push(...paragraphMerge);
  // A long paragraph can span all columns and would otherwise make the first
  // table column enormous. Size columns from table cells when a table exists.
  const widthRows = tableRows.length > 0 ? tableRows : rows;
  const widths = Array.from({ length: maxColumns }, (_, column) => {
    const longest = widthRows.reduce((max, row) => Math.max(max, displayWidth(String(row[column] ?? ''))), 0);
    const minimum = tableRows.length > 0 ? 10 : 12;
    const maximum = tableRows.length > 0 ? 48 : 56;
    return Math.min(maximum, Math.max(minimum, Math.round(longest * 1.2 + 3)));
  });
  const sheetWidth = widths.reduce((sum, width) => sum + width, 0);
  for (const row of paragraphRows) {
    const text = rows[row]?.[0] ?? '';
    const lines = Math.max(1, Math.ceil(text.length / Math.max(20, sheetWidth * 0.7)));
    rowHeights.set(row, Math.min(240, Math.max(18, lines * 18)));
  }
  return {
    name,
    rows,
    table: false,
    tables,
    merges,
    columnWidths: widths,
    rowHeights: rows.map((_, row) => rowHeights.get(row) ?? 0),
  };
}

/** Includes tables even for hand-built layouts whose `blocks` omit them. */
function blocksForPage(page: PdfLayout['pages'][number]): PdfBlock[] {
  const blocks = [...page.blocks];
  if (!blocks.some((block) => block.type === 'table')) {
    for (const table of page.tables.filter((entry) => !entry.merged && entry.rows.length > 0)) {
      blocks.push({ type: 'table', rows: table.rows, columnWeights: table.columnWeights, cells: table.cells });
    }
  }
  return blocks;
}

export function layoutToOneSheet(layout: PdfLayout, fallbackText: string): { sheet: SheetSpec; notes: string[] } {
  const blocks: PdfBlock[] = [];
  layout.pages.forEach((page, pageIndex) => {
    if (pageIndex > 0 && blocks.length > 0) blocks.push({ type: 'paragraph', text: '' });
    blocks.push(...blocksForPage(page));
  });
  let sheet = blocksToSheet(blocks, workbookSheetName(layout));
  if (sheet.rows.length === 0 && layout.tableCount === 0) {
    const rows = splitPdfText(fallbackText).flatMap((page, pageIndex) => [
      ...(pageIndex > 0 ? [[]] : []),
      ...page.map((line) => [line]),
    ]);
    sheet = { name: workbookSheetName(layout), rows, table: false };
  }
  const scanned = layout.imageTables ?? 0;
  const notes = [
    layout.tableCount > 0
      ? `已识别 ${layout.tableCount} 个表格，正文与表格按阅读顺序写入一个工作表${scanned > 0 ? `，其中 ${scanned} 个来自扫描页图像识别` : ''}`
      : '未检测到稳定的表格结构，已按阅读顺序写入一个工作表',
    '合并单元格、跨页表格、公式和扫描版内容已尝试自动重建，仍建议人工核对',
  ];
  return { sheet, notes };
}

export function layoutToSheets(
  layout: PdfLayout,
  fallbackText: string,
  mode: ExcelSheetMode = 'single',
): { sheets: SheetSpec[]; notes: string[] } {
  if (mode === 'single') {
    const { sheet, notes } = layoutToOneSheet(layout, fallbackText);
    return { sheets: [sheet], notes };
  }

  const fallbackPages = splitPdfText(fallbackText);
  const sheets = layout.pages.map((page, pageIndex) => {
    const sheet = blocksToSheet(blocksForPage(page), sheetName(`第${page.index}页`, `Page ${page.index}`));
    if (sheet.rows.length > 0) return sheet;
    const lines = fallbackPages[pageIndex] ?? [];
    return {
      name: sheetName(`第${page.index}页`, `Page ${page.index}`),
      rows: lines.length ? lines.map((line) => [line]) : [[]],
      table: false,
    };
  });
  if (layout.pages.length === 0) {
    sheets.push(...fallbackPages.map((lines, pageIndex) => ({
      name: sheetName(`第${pageIndex + 1}页`, `Page ${pageIndex + 1}`),
      rows: lines.length ? lines.map((line) => [line]) : [[]],
      table: false,
    })));
  }
  const scanned = layout.imageTables ?? 0;
  return {
    sheets,
    notes: [
      layout.tableCount > 0
        ? `已识别 ${layout.tableCount} 个表格，按 PDF 页码分别写入工作表${scanned > 0 ? `，其中 ${scanned} 个来自扫描页图像识别` : ''}`
        : '未检测到稳定的表格结构，已按 PDF 页码分别写入工作表',
      '合并单元格、跨页表格、公式和扫描版内容已尝试自动重建，仍建议人工核对',
    ],
  };
}

function docBlocks(layout: PdfLayout): DocBlock[] {
  const blocks: DocBlock[] = [];
  layout.pages.forEach((page) => {
    for (const block of page.blocks) {
      if (block.type === 'table') blocks.push({ type: 'table', rows: block.rows, columnWeights: block.columnWeights, cells: block.cells });
      else if (block.type === 'heading') blocks.push({ type: 'heading', text: block.text });
      else blocks.push({ type: 'paragraph', text: block.text });
    }
  });
  return blocks;
}

export async function convertPdf(input: ConverterInput): Promise<ConvertOutcome> {
  const mode = input.options.pdf?.mode ?? 'editable';
  const dpi = input.options.pdf?.dpi ?? 150;
  if (input.target === 'png' || input.target === 'jpg') {
    const result = await extractPdfImages(input, input.target, dpi);
    input.onProgress?.(100);
    return {
      outputPath: result.outputPath,
      outputExt: result.outputPath.endsWith('.zip') ? 'zip' : input.target,
      note: result.note,
    };
  }

  if (input.target === 'txt') {
    let text = await pdfToText(input.inputPath, input);
    let ocrNote = '';
    if (text.trim() === '' && input.options.pdf?.ocr === true) {
      const ocr = await ocrPdf(input);
      ocrNote = ocr.note;
      if (ocr.path) text = await pdfToText(ocr.path, input);
    }
    const out = join(input.outputDir, `${input.outputBase}.txt`);
    await writeFile(out, text.replace(/\f$/, '').replace(/\r\n/g, '\n'), 'utf8');
    input.onProgress?.(100);
    await requireOutput(out);
    return { outputPath: out, outputExt: 'txt', note: ocrNote || undefined };
  }

  if (input.target === 'xlsx') {
    let source = input;
    let layout = await analyzePdfLayout(input);
    const ocrNotes: string[] = [];
    if (!layout.hasText && input.options.pdf?.ocr === true) {
      const ocr = await ocrPdf(input);
      if (ocr.note) ocrNotes.push(ocr.note);
      if (ocr.path) {
        source = { ...input, inputPath: ocr.path };
        layout = await analyzePdfLayout(source);
      }
    }
    input.onProgress?.(35);
    const fallbackText = layout.hasText ? await pdfToText(source.inputPath, source) : '';
    const { sheets, notes } = layoutToSheets(layout, fallbackText, input.options.pdf?.sheetMode ?? 'single');
    const out = join(input.outputDir, `${input.outputBase}.xlsx`);
    await writeFile(out, buildXlsx(sheets.length > 0 ? sheets : [{ name: 'Sheet1', rows: [[]] }]));
    input.onProgress?.(100);
    await requireOutput(out);
    return { outputPath: out, outputExt: 'xlsx', note: [...ocrNotes, ...notes].join('；') };
  }

  if (input.target === 'pptx' || input.target === 'odp') {
    let text = await pdfToText(input.inputPath, input);
    let ocrNote = '';
    if (mode === 'editable' && text.trim() === '' && input.options.pdf?.ocr === true) {
      const ocr = await ocrPdf(input);
      ocrNote = ocr.note;
      if (ocr.path) text = await pdfToText(ocr.path, input);
    }
    const linesByPage = splitPdfText(text);
    const editable = linesByPage.some((page) => page.length > 0);
    let temp: string;
    if (mode === 'editable' && editable) {
      temp = join(input.workDir, 'editable.pptx');
      await writeFile(temp, buildPptxFromText(linesByPage));
    } else {
      const rendered = await renderPdfPages(input, 'jpg', dpi);
      temp = join(input.workDir, 'layout.pptx');
      await writeFile(temp, buildPptxFromImages(rendered.pages));
    }
    const out = join(input.outputDir, `${input.outputBase}.${input.target}`);
    if (input.target === 'pptx') {
      await copyFile(temp, out);
    } else {
      const produced = await officeConvert({ ...input, target: 'odp' }, temp);
      await copyFile(produced, out);
    }
    input.onProgress?.(100);
    await requireOutput(out);
    return { outputPath: out, outputExt: input.target, note: ocrNote || undefined };
  }

  if (input.target === 'docx' || input.target === 'odt' || input.target === 'rtf') {
    const out = join(input.outputDir, `${input.outputBase}.${input.target}`);
    const ocrNotes: string[] = [];
    let source = input;
    let layout = mode === 'editable' ? await analyzePdfLayout(input) : null;
    if (mode === 'editable' && layout && !layout.hasText && input.options.pdf?.ocr === true) {
      const ocr = await ocrPdf(input);
      if (ocr.note) ocrNotes.push(ocr.note);
      if (ocr.path) {
        source = { ...input, inputPath: ocr.path };
        layout = await analyzePdfLayout(source);
      }
    }
    const hasText = layout?.hasText === true;
    if (mode === 'layout' || !hasText) {
      if (mode === 'editable' && layout && !layout.hasText) input.onProgress?.(20);
      const rendered = await renderPdfPages(source, 'jpg', dpi);
      const imageDoc = buildDocxFromImages(rendered.pages);
      if (input.target === 'docx') {
        await writeFile(out, imageDoc);
      } else {
        const temp = join(input.workDir, 'layout.docx');
        await writeFile(temp, imageDoc);
        const produced = await officeConvert({ ...input, target: input.target }, temp);
        await copyFile(produced, out);
      }
      input.onProgress?.(100);
      await requireOutput(out);
      const note = mode === 'layout'
        ? '已按页面图像输出，最接近原 PDF 外观；文字和表格不可编辑'
        : '该 PDF 没有可提取的文本层（可能是扫描件），已自动使用版式模式；表格为整页图像，不是可编辑单元格；需要可编辑文字时请在 PDF 参数里开启扫描件识别';
      return { outputPath: out, outputExt: input.target, note: [...ocrNotes, note].join('；') };
    }

    const blocks = docBlocks(layout!);
    const docx = buildDocxFromBlocks(blocks);
    if (input.target === 'docx') {
      await writeFile(out, docx);
    } else {
      const temp = join(input.workDir, 'editable.docx');
      await writeFile(temp, docx);
      const produced = await officeConvert({ ...input, target: input.target }, temp);
      await copyFile(produced, out);
    }
    input.onProgress?.(100);
    await requireOutput(out);
    const scanned = layout!.imageTables ?? 0;
    const note = layout!.tableCount > 0
      ? scanned > 0
        ? `已识别 ${layout!.tableCount} 个表格并重建为带边框的可编辑表格，其中 ${scanned} 个来自扫描页图像识别；合并单元格、跨页表格和公式已尝试自动重建，仍建议人工核对`
        : `已识别 ${layout!.tableCount} 个表格并重建为带边框的可编辑表格；合并单元格、跨页表格和公式已尝试自动重建，仍建议人工核对`
      : '未检测到稳定的表格结构，已重建可编辑文字；复杂排版需人工检查';
    return { outputPath: out, outputExt: input.target, note: [...ocrNotes, note].join('；') };
  }

  throw new ConversionError('不支持的 PDF 目标格式');
}

export async function convertDocument(input: ConverterInput): Promise<ConvertOutcome> {
  const group = officeGroup(input.sourceExt);
  if (!group) throw new ConversionError('不支持的办公文档格式');
  const produced = await officeConvert(input);
  const outputPath = join(input.outputDir, `${input.outputBase}.${input.target}`);
  await copyFile(produced, outputPath);
  input.onProgress?.(100);
  await requireOutput(outputPath);
  return { outputPath, outputExt: input.target };
}

/** A small helper used by tests and diagnostics. */
export function outputStem(path: string): string {
  const name = basename(path);
  const ext = extname(name);
  return name.slice(0, -ext.length);
}
