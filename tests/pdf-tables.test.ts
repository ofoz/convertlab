import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePdfLayout, buildRows, detectTextTables, type PdfLayout } from '../src/converters/pdf-tables.ts';
import { layoutToSheets } from '../src/converters/documents.ts';
import { BINS, fixture, POppler } from './testkit.ts';

const ready = POppler;

async function analyze(name: string): Promise<PdfLayout> {
  return analyzePdfLayout({
    inputPath: fixture(name),
    outputDir: fixture('.'),
    outputBase: name.replace(/\..+$/, ''),
    sourceExt: 'pdf',
    target: 'docx',
    options: {},
    workDir: fixture('.'),
    timeoutMs: 120_000,
    bins: BINS,
  });
}

test('带边框 PDF 的表格被重建为规整单元格，标题与脚注不进入表格', { skip: ready ? false : '需要 Poppler pdftotext' }, async () => {
  const layout = await analyze('table-bordered.pdf');
  assert.equal(layout.hasText, true);
  assert.equal(layout.pages.length, 1);
  assert.equal(layout.tableCount, 1);

  const page = layout.pages[0]!;
  const table = page.tables[0]!;
  assert.equal(table.columnCount, 6);
  assert.equal(table.rows.length, 6, '表头 + 5 行数据');
  assert.deepEqual(table.rows[0], ['序号', '物料名称', '规格', '数量', '单价（元）', '小计（元）']);
  assert.deepEqual(table.rows[1], ['1', '打印纸', 'A4 80g', '40', '28.50', '1140.00']);
  assert.deepEqual(table.rows[5], ['5', '合计', '—', '169', '—', '5886.00']);
  assert.equal(table.columnWeights.length, 6);
  assert.ok(table.columnWeights.every((weight) => weight > 0), '每列都应有正的相对宽度');
  for (const row of table.rows) assert.equal(row.length, 6, `行应补齐为 6 列：${row.join('|')}`);

  // 标题与说明必须留在表格之外的普通文本块里
  const headings = page.blocks.filter((block) => block.type === 'heading').map((block) => (block.type === 'heading' ? block.text : ''));
  assert.ok(headings.some((text) => text.includes('采购明细')), '标题应识别为标题块');
  const paragraphs = page.blocks.filter((block) => block.type === 'paragraph').map((block) => (block.type === 'paragraph' ? block.text : ''));
  assert.ok(paragraphs.some((text) => text.includes('制表部门')), '制表信息不应被吞进表格');
  assert.ok(paragraphs.some((text) => text.includes('含税')), '脚注不应被吞进表格');
  assert.ok(!table.rows.flat().join(' ').includes('制表部门'), '表格单元格里不应出现制表信息');
  assert.ok(!table.rows.flat().join(' ').includes('含税'), '表格单元格里不应出现脚注');
});

test('无边框 PDF 表格同样按列对齐识别', { skip: ready ? false : '需要 Poppler pdftotext' }, async () => {
  const layout = await analyze('table-borderless.pdf');
  assert.equal(layout.tableCount, 1);
  const table = layout.pages[0]!.tables[0]!;
  assert.equal(table.columnCount, 5);
  assert.equal(table.rows.length, 5, '表头 + 4 行数据');
  assert.deepEqual(table.rows[0], ['区域', '一月', '二月', '三月', '季度合计']);
  assert.deepEqual(table.rows[1], ['华东', '128.4', '131.7', '156.2', '416.3']);
  assert.deepEqual(table.rows[4], ['西南', '54.2', '58.9', '63.4', '176.5']);
});

/** Builds words for one synthetic line: `chunks` laid out from `x`, each a run. */
function lineWords(y: number, chunks: Array<{ x0: number; x1: number; text: string }>) {
  return chunks.map((chunk) => ({ text: chunk.text, x0: chunk.x0, y0: y, x1: chunk.x1, y1: y + 10 }));
}

test('两端对齐的段落不会被误判为无边框表格', () => {
  // Justified body text lines up on both margins, so a naive "left and right
  // edge are stable" rule fires. The gutters inside each line wander, though,
  // and no whitespace channel survives across lines.
  const gutters = [
    [98, 186, 296],
    [226, 332, 402],
    [74, 268, 388],
    [160, 240, 430],
    [112, 300, 356],
  ];
  const words = gutters.flatMap((edges, index) => {
    const y = 100 + index * 18;
    const xs = [40, ...edges, 470];
    return lineWords(y, xs.slice(0, -1).map((x0, position) => ({
      x0,
      x1: xs[position + 1]! - 4,
      text: `文本片段${index}${position}`,
    })));
  });
  assert.equal(detectTextTables(buildRows(words)).length, 0);
});

test('列间空白通道稳定的无边框表格仍会被识别', () => {
  const rows = [
    ['区域', '一月', '二月'],
    ['华东', '1,240', '1,380'],
    ['华南', '980', '1,050'],
    ['华北', '760', '880'],
  ];
  const words = rows.flatMap((cells, index) => {
    const y = 100 + index * 18;
    return lineWords(y, [
      { x0: 40, x1: 120, text: cells[0]! },
      { x0: 170, x1: 250, text: cells[1]! },
      { x0: 300, x1: 380, text: cells[2]! },
    ]);
  });
  const tables = detectTextTables(buildRows(words));
  assert.equal(tables.length, 1);
  assert.deepEqual(tables[0]!.rows, rows);
});

test('跨页续接的表格不会被重复写入 Excel 工作表', () => {
  const table = (rows: string[][], merged: boolean) => ({
    rows,
    columnCount: 2,
    columnWeights: [1, 1],
    bounds: { x0: 50, x1: 500, y0: 100, y1: 700 },
    merged,
  });
  const layout: PdfLayout = {
    pages: [
      {
        index: 1,
        width: 595,
        height: 842,
        blocks: [],
        tables: [table([['序号', '名称'], ['1', '打印纸'], ['2', '签字笔']], false)],
        lines: [],
        textLength: 20,
      },
      {
        index: 2,
        width: 595,
        height: 842,
        blocks: [],
        tables: [table([['序号', '名称'], ['2', '签字笔'], ['3', '文件夹']], true)],
        lines: [],
        textLength: 20,
      },
    ],
    hasText: true,
    tableCount: 1,
    textLength: 40,
  };

  const { sheets } = layoutToSheets(layout, '');
  const tableSheets = sheets.filter((sheet) => sheet.table);
  assert.equal(tableSheets.length, 1, '续接表已合并，不应再生成第二个表工作表');
  assert.deepEqual(tableSheets[0]!.rows, [['序号', '名称'], ['1', '打印纸'], ['2', '签字笔']]);
});
