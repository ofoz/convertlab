import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePdfLayout, buildRows, detectTextTables, fuseRapidTables, mergeCrossPageTables, type PdfLayout, type PdfTable } from '../src/converters/pdf-tables.ts';
import { buildRapidTables, parseTesseractTsv, type RapidPrediction } from '../src/converters/pdf-rapid-table.ts';
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

test('PDF 转 Excel 默认把全部正文和表格放进一个工作表', () => {
  const layout: PdfLayout = {
    pages: [
      {
        index: 1, width: 595, height: 842, textLength: 20, lines: [],
        blocks: [
          { type: 'heading', text: '第一章' },
          { type: 'paragraph', text: '这是第一段正文。' },
          { type: 'table', rows: [['名称', '数量'], ['A', '1']], columnWeights: [1, 1] },
          { type: 'paragraph', text: '表格后的正文。' },
        ],
        tables: [],
      },
      {
        index: 2, width: 595, height: 842, textLength: 10, lines: [],
        blocks: [
          { type: 'heading', text: '第二章' },
          { type: 'table', rows: [['指标', '得分'], ['B', '90']], columnWeights: [1, 1] },
        ],
        tables: [],
      },
    ],
    hasText: true, tableCount: 2, textLength: 30,
  };
  const { sheets } = layoutToSheets(layout, '');
  assert.equal(sheets.length, 1, '默认只能生成一个工作表');
  const sheet = sheets[0]!;
  assert.equal(sheet.tables?.length, 2, '两张表都应保留为带边框区块');
  assert.deepEqual(sheet.merges?.map((merge) => `${merge.startRow}:${merge.endColumn}`), ['0:1', '1:1', '6:1', '8:1']);
  assert.deepEqual(sheet.rows.filter((row) => row.length > 0), [
    ['第一章'], ['这是第一段正文。'], ['名称', '数量'], ['A', '1'],
    ['表格后的正文。'], ['第二章'], ['指标', '得分'], ['B', '90'],
  ]);
});

test('混合工作表不让长正文撑宽表格列', () => {
  const layout: PdfLayout = {
    pages: [{
      index: 1, width: 595, height: 842, textLength: 100, lines: [],
      blocks: [
        { type: 'paragraph', text: '这是一段很长很长的正文'.repeat(20) },
        { type: 'table', rows: [['名称', '数量'], ['A', '1']], columnWeights: [1, 1] },
      ],
      tables: [],
    }],
    hasText: true, tableCount: 1, textLength: 100,
  };
  const { sheets } = layoutToSheets(layout, '');
  assert.equal(sheets.length, 1);
  assert.ok(sheets[0]!.columnWidths?.every((width) => width <= 20), '列宽应只由表格单元格内容决定');
  assert.deepEqual(sheets[0]!.merges, [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 }]);
});

test('PDF 转 Excel 可显式按页拆成多个工作表', () => {
  const layout: PdfLayout = {
    pages: [
      { index: 1, width: 595, height: 842, textLength: 2, lines: [], blocks: [{ type: 'paragraph', text: '第一页' }], tables: [] },
      { index: 2, width: 595, height: 842, textLength: 2, lines: [], blocks: [{ type: 'paragraph', text: '第二页' }], tables: [] },
    ],
    hasText: true, tableCount: 0, textLength: 4,
  };
  const { sheets } = layoutToSheets(layout, '', 'page');
  assert.equal(sheets.length, 2);
  assert.deepEqual(sheets.map((sheet) => sheet.rows), [[['第一页']], [['第二页']]]);
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
  assert.equal(sheets.length, 1, '默认合并为一个工作表');
  assert.deepEqual(sheets[0]!.rows.filter((row) => row.length > 0), [['序号', '名称'], ['1', '打印纸'], ['2', '签字笔']]);
});


function boundaryTable(rows: string[][], y0: number, y1: number, cells?: PdfLayout['pages'][number]['tables'][number]['cells']): PdfTable {
  return {
    merged: false,
    rows,
    columnCount: rows[0]?.length ?? 0,
    columnWeights: [160, 290],
    bounds: { x0: 50, x1: 500, y0, y1 },
    ...(cells ? { cells } : {}),
  };
}

test('跨页续表只在页面边界相邻时合并，并删除重复表头与重复行', () => {
  const firstRows = [['序号', '名称'], ['1', '打印纸'], ['2', '签字笔']];
  const secondRows = [['序号', '名称'], ['2', '签字笔'], ['3', '文件夹']];
  const firstTable = boundaryTable(firstRows, 100, 730);
  const secondTable = boundaryTable(secondRows, 45, 760);
  const pages = [
    {
      index: 1, width: 595, height: 842, lines: [], textLength: 20,
      blocks: [{ type: 'table' as const, rows: firstRows, columnWeights: [160, 290] }],
      tables: [firstTable],
    },
    {
      index: 2, width: 595, height: 842, lines: [], textLength: 20,
      blocks: [{ type: 'table' as const, rows: secondRows, columnWeights: [160, 290] }],
      tables: [secondTable],
    },
  ];
  mergeCrossPageTables(pages);
  assert.deepEqual(firstTable.rows, [['序号', '名称'], ['1', '打印纸'], ['2', '签字笔'], ['3', '文件夹']]);
  assert.equal(secondTable.merged, true);
  assert.equal(pages[1]!.blocks.length, 0);
});

test('页底和页顶两张同列宽独立表不会误合并', () => {
  const firstRows = [['项目', '金额'], ['A', '10']];
  const secondRows = [['项目', '金额'], ['B', '20']];
  const firstTable = boundaryTable(firstRows, 100, 550, undefined);
  const secondTable = boundaryTable(secondRows, 100, 600, undefined);
  const pages = [
    {
      index: 1, width: 595, height: 842, lines: [], textLength: 10,
      blocks: [
        { type: 'paragraph' as const, text: '第一张表后的说明' },
        { type: 'table' as const, rows: firstRows, columnWeights: [160, 290] },
      ],
      tables: [firstTable],
    },
    {
      index: 2, width: 595, height: 842, lines: [], textLength: 10,
      blocks: [
        { type: 'heading' as const, text: '另一张表' },
        { type: 'table' as const, rows: secondRows, columnWeights: [160, 290] },
      ],
      tables: [secondTable],
    },
  ];
  mergeCrossPageTables(pages);
  assert.deepEqual(firstTable.rows, firstRows);
  assert.deepEqual(secondTable.rows, secondRows);
  assert.equal(pages[1]!.blocks.length, 2);
});

test('跨页合并会平移第二页合并单元格的行坐标', () => {
  const firstRows = [['标题', ''], ['A', 'B']];
  const secondRows = [['标题', ''], ['C', 'D']];
  const firstCells = [
    { row: 0, column: 0, rowSpan: 1, columnSpan: 2, text: '标题' },
    { row: 1, column: 0, rowSpan: 1, columnSpan: 1, text: 'A' },
    { row: 1, column: 1, rowSpan: 1, columnSpan: 1, text: 'B' },
  ];
  const secondCells = [
    { row: 0, column: 0, rowSpan: 1, columnSpan: 2, text: '标题' },
    { row: 1, column: 0, rowSpan: 1, columnSpan: 1, text: 'C' },
    { row: 1, column: 1, rowSpan: 1, columnSpan: 1, text: 'D' },
  ];
  const firstTable = boundaryTable(firstRows, 100, 730, firstCells);
  const secondTable = boundaryTable(secondRows, 45, 760, secondCells);
  const pages = [
    {
      index: 1, width: 595, height: 842, lines: [], textLength: 10,
      blocks: [{ type: 'table' as const, rows: firstRows, columnWeights: [160, 290], cells: firstCells }],
      tables: [firstTable],
    },
    {
      index: 2, width: 595, height: 842, lines: [], textLength: 10,
      blocks: [{ type: 'table' as const, rows: secondRows, columnWeights: [160, 290], cells: secondCells }],
      tables: [secondTable],
    },
  ];
  mergeCrossPageTables(pages);
  assert.deepEqual(firstTable.rows, [['标题', ''], ['A', 'B'], ['C', 'D']]);
  assert.equal(firstTable.cells?.find((cell) => cell.text === 'C')?.row, 2);
  assert.equal(firstTable.cells?.find((cell) => cell.text === 'D')?.row, 2);
});


test('Tesseract TSV 会过滤低置信度与无效坐标，并缩放回 PDF 点', () => {
  const tsv = [
    'level	page_num	block_num	par_num	line_num	word_num	left	top	width	height	conf	text',
    '5	1	1	1	1	1	100	50	80	20	91.5	表格',
    '5	1	1	1	1	2	200	50	40	20	21.0	噪声',
    '5	1	1	1	1	3		60	20	20	88.0	坏坐标',
    '5	1	1	1	1	4	300	80	60	20	87.0	数据',
  ].join('\n');
  const words = parseTesseractTsv(tsv, 0.5);
  assert.deepEqual(words.map((word) => word.text), ['表格', '数据']);
  assert.deepEqual(words.map((word) => [word.x0, word.y0, word.x1, word.y1]), [[50, 25, 90, 35], [150, 40, 180, 50]]);
});

test('RapidTable 模型结果会按 OCR 文本生成合并单元格', () => {
  const pages = [{ index: 1, width: 600, height: 800 }];
  const predictions: RapidPrediction[] = [{
    pageIndex: 1,
    imageWidth: 1200,
    imageHeight: 1600,
    logicPoints: [[0, 0, 0, 1], [1, 2, 0, 0], [1, 1, 1, 1], [2, 2, 1, 1]],
    cellBboxes: [
      [100, 100, 1100, 200],
      [100, 200, 500, 400],
      [500, 200, 1100, 300],
      [500, 300, 1100, 400],
    ],
  }];
  const words = new Map([[1, [
    { text: '合并标题', x0: 120, y0: 55, x1: 280, y1: 90 },
    { text: '纵向左值', x0: 70, y0: 120, x1: 140, y1: 180 },
    { text: '右一', x0: 280, y0: 120, x1: 350, y1: 145 },
    { text: '右二', x0: 280, y0: 165, x1: 350, y1: 190 },
  ]]]);
  const [table] = buildRapidTables(pages, predictions, words);
  assert.ok(table);
  assert.equal(table.columnCount, 2);
  assert.equal(table.rows.length, 3);
  assert.equal(table.rows[0]![0], '合并标题');
  assert.equal(table.cells?.find((cell) => cell.row === 0 && cell.column === 0)?.columnSpan, 2);
  assert.equal(table.cells?.find((cell) => cell.row === 1 && cell.column === 0)?.rowSpan, 2);
  assert.equal(table.cells?.filter((cell) => cell.verticalContinuation).length, 1);
  assert.match(table.rows.flat().join(' '), /纵向左值/);
  assert.match(table.rows.flat().join(' '), /右一/);
  assert.match(table.rows.flat().join(' '), /右二/);
});

test('RapidTable 融合只接受完整的新表，并保留已有正文段落', () => {
  const native = [{
    rows: [['甲', '乙'], ['1', '2']],
    columnCount: 2,
    columnWeights: [100, 100],
    bounds: { x0: 40, y0: 100, x1: 540, y1: 250 },
  }];
  const complete = {
    page: 1,
    rows: [['指标', '结果'], ['准确率', '98%'], ['召回率', '96%']],
    columnCount: 2,
    columnWeights: [120, 180],
    bounds: { x0: 50, y0: 400, x1: 550, y1: 620 },
    cells: [],
  };
  const paragraphFalsePositive = {
    page: 1,
    rows: [['正常正文'], ['另一段']],
    columnCount: 1,
    columnWeights: [400],
    bounds: { x0: 40, y0: 700, x1: 500, y1: 760 },
  };
  const fused = fuseRapidTables(native, [complete, paragraphFalsePositive]);
  assert.equal(fused.length, 2);
  assert.deepEqual(fused[0]!.rows, native[0]!.rows);
  assert.deepEqual(fused[1]!.rows, complete.rows);
  assert.equal(fused.filter((table) => table.rows.flat().some((cell) => cell === '正常正文')).length, 0);
});
