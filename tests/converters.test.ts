import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDocxFromBlocks, buildXlsx, displayWidth } from '../src/converters/ooxml.ts';
import { runConversion } from '../src/converters/dispatch.ts';
import { BINS, countOf, e2eEnabled, fixture, LIBREOFFICE, POppler, textPart } from './testkit.ts';

const ROWS = [
  ['序号', '物料名称', '数量', '单价（元）'],
  ['1', '打印纸', '40', '28.50'],
  ['2', '签字笔', '120', '2.80'],
];

test('DOCX 表格写出真正的 w:tbl 结构并显式声明边框', () => {
  const docx = buildDocxFromBlocks([
    { type: 'heading', text: '采购明细' },
    { type: 'paragraph', text: '制表部门：行政部' },
    { type: 'table', rows: ROWS, columnWeights: [30, 80, 40, 60] },
    { type: 'paragraph', text: '说明：含税价。' },
  ], { title: '报告' });

  const xml = textPart(docx, 'word/document.xml');
  assert.equal(countOf(xml, '<w:tbl>'), 1, '必须且只能有一个表格');
  assert.equal(countOf(xml, '<w:trPr>'), ROWS.length, '行数应与数据一致');
  assert.equal(countOf(xml, '<w:tc>'), ROWS.length * 4, '列数应与数据一致');
  assert.match(xml, /<w:tblBorders>/);
  assert.match(xml, /<w:insideH w:val="single"/);
  assert.match(xml, /<w:insideV w:val="single"/);
  assert.match(xml, /<w:tblHeader\/>/, '表头行应标记为重复表头');
  assert.match(xml, /<w:gridCol w:w="\d+"\/>/, '应写出固定网格列宽');
  assert.equal(countOf(xml, '<w:gridCol'), 4);
  assert.match(xml, /采购明细/);
  assert.match(xml, /制表部门：行政部/);
  // 表头单元格使用加粗与浅色底纹
  assert.match(xml, /<w:b\/><w:color w:val="0F172A"\/>[\s\S]*?<w:t xml:space="preserve">序号/);
  assert.match(xml, /<w:shd w:val="clear" w:color="auto" w:fill="F1F5F9"\/>/);
  // 表头与数据必须落在不同单元格，不能被合并成一行文本
  assert.ok(!xml.includes('>序号物料名称<'), '单元格之间不能粘连');
});

test('DOCX 会转义 XML 特殊字符而不是破坏结构', () => {
  const docx = buildDocxFromBlocks([{ type: 'table', rows: [['A & B', '<x>'], ['1', '2']] }]);
  const xml = textPart(docx, 'word/document.xml');
  assert.match(xml, /A &amp; B/);
  assert.match(xml, /&lt;x&gt;/);
  assert.equal(countOf(xml, '<w:tc>'), 4);
});

test('DOCX 包内包含样式与关系部件', () => {
  const docx = buildDocxFromBlocks([{ type: 'paragraph', text: 'hello' }]);
  const styles = textPart(docx, 'word/styles.xml');
  assert.match(styles, /w:styleId="Heading1"/);
  assert.match(styles, /w:eastAsia="Microsoft YaHei"/);
  assert.match(textPart(docx, '[Content_Types].xml'), /styles\.xml/);
  assert.match(textPart(docx, 'word/_rels/document.xml.rels'), /Relationships/);
});

test('XLSX 表格单元格带细边框、表头样式与数值类型', () => {
  const xlsx = buildXlsx([
    { name: '第1页 表1', rows: ROWS, table: true, headerRow: true, columnWeights: [30, 80, 40, 70] },
  ]);
  const sheet = textPart(xlsx, 'xl/worksheets/sheet1.xml');
  const styles = textPart(xlsx, 'xl/styles.xml');

  assert.match(sheet, /<pane ySplit="1" topLeftCell="A2"/, '表头应冻结');
  assert.equal(countOf(sheet, ' s="2"'), 4, '表头四个单元格使用表头样式');
  const bordered = (sheet.match(/ s="[134]"/g) ?? []).length;
  assert.equal(bordered, 8, '每个数据单元格都应带边框样式');
  assert.match(sheet, /<c r="C2" s="3"><v>40<\/v><\/c>/, '短数字列居中并写成数值单元格');
  assert.match(sheet, /<c r="D2" s="4"><v>28.50<\/v><\/c>/, '两位小数金额应带 0.00 数字格式');
  assert.match(sheet, /t="inlineStr"/);
  assert.match(styles, /<borders count="2">/);
  assert.match(styles, /numFmtId="2"/);
  assert.match(styles, /<cellXfs count="6">/);
  assert.match(styles, /<alignment vertical="top" wrapText="1"\/>/);

  const cols = [...sheet.matchAll(/<col min="(\d+)" max="\d+" width="(\d+)"/g)].map((match) => Number(match[2]));
  assert.equal(cols.length, 4);
  assert.ok(cols[1]! > cols[0]!, '列宽应按源表格比例分配（物料名称比序号宽）');
  assert.ok(cols[3]! > cols[2]!, '单价列应宽于数量列');
});

test('XLSX 混合工作表只为表格区块加边框，正文跨列合并', () => {
  const xlsx = buildXlsx([{
    name: '报告',
    rows: [['概述'], [], ROWS[0]!, ROWS[1]!, [], ['结论']],
    tables: [{ startRow: 2, endRow: 3, headerRow: true }],
    merges: [
      { startRow: 0, endRow: 0, startColumn: 0, endColumn: 3 },
      { startRow: 5, endRow: 5, startColumn: 0, endColumn: 3 },
    ],
  }]);
  const sheet = textPart(xlsx, 'xl/worksheets/sheet1.xml');
  assert.match(sheet, /<mergeCell ref="A1:D1"\/>/);
  assert.match(sheet, /<mergeCell ref="A6:D6"\/>/);
  assert.equal(countOf(sheet, ' s="2"'), 4, '只有表格首行使用表头样式');
  assert.equal(countOf(sheet, ' s="0"'), 0, '正文单元格不应带边框样式');
  assert.match(sheet, /<c r="A3" s="2" t="inlineStr"><is><t xml:space="preserve">序号<\/t><\/is><\/c>/);
  assert.match(sheet, /<c r="C4" s="3"><v>40<\/v><\/c>/);
  assert.match(sheet, /<c r="A1" s="5" t="inlineStr"><is><t xml:space="preserve">概述<\/t><\/is><\/c>/);
  assert.doesNotMatch(sheet, /<pane /, '混合工作表不能冻结第一行的正文');
  assert.match(sheet, /<c r="A1" s="5" t="inlineStr">/, '正文应开启自动换行');
});

test('XLSX 会过滤单格冗余合并', () => {
  const xlsx = buildXlsx([{
    name: '正文',
    rows: [['单列正文']],
    merges: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }],
  }]);
  const sheet = textPart(xlsx, 'xl/worksheets/sheet1.xml');
  assert.doesNotMatch(sheet, /<mergeCells/);
});

test('XLSX 纯文本工作表默认不加边框', () => {
  const xlsx = buildXlsx([{ name: '正文', rows: [['第一段'], ['第二段']], table: false }]);
  const sheet = textPart(xlsx, 'xl/worksheets/sheet1.xml');
  assert.equal(countOf(sheet, ' s="1"'), 0);
  assert.doesNotMatch(sheet, /<pane /);
});

test('displayWidth 把中日韩字符按双宽计算', () => {
  assert.equal(displayWidth('abc'), 3);
  assert.equal(displayWidth('物料名称'), 8);
  assert.equal(displayWidth('A4 80g'), 6);
});

const e2eReady = e2eEnabled && POppler && LIBREOFFICE;

test('开启 OCR 选项时，已有文本层的 PDF 不会调用 OCR 仍走可编辑表格', { skip: POppler ? false : '需要 Poppler pdftotext' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'convertlab-ocr-'));
  try {
    const workDir = join(root, 'work');
    const outputDir = join(root, 'out');
    await mkdir(workDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });
    // ocrmypdf 指向不存在的可执行文件：只要真正调用就会失败，从而证明有文本层时会跳过 OCR。
    const result = await runConversion({
      inputPath: fixture('table-bordered.pdf'),
      outputDir,
      outputBase: 'bordered',
      sourceExt: 'pdf',
      sourceKind: 'pdf',
      target: 'docx',
      options: { pdf: { mode: 'editable', dpi: 150, ocr: true } },
      workDir,
      timeoutMs: 120_000,
    }, { bins: { ...BINS, ocrmypdf: join(root, 'missing-ocrmypdf') } });
    assert.equal(result.outputExt, 'docx');
    assert.doesNotMatch(result.note ?? '', /OCR/);
    const bytes = await readFile(result.outputPath);
    assert.match(textPart(bytes, 'word/document.xml'), /<w:tbl>/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('PDF 转 DOCX/XLSX 端到端保留表格结构', { skip: e2eReady ? false : '需要设置 CONVERTLAB_E2E=1 且本机安装 Poppler 与 LibreOffice' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'convertlab-e2e-'));
  try {
    for (const target of ['docx', 'xlsx'] as const) {
      const workDir = join(root, `work-${target}`);
      const outputDir = join(root, `out-${target}`);
      await mkdir(workDir, { recursive: true });
      await mkdir(outputDir, { recursive: true });
      const result = await runConversion({
        inputPath: fixture('table-bordered.pdf'),
        outputDir,
        outputBase: 'bordered',
        sourceExt: 'pdf',
        sourceKind: 'pdf',
        target,
        options: { pdf: { mode: 'editable', dpi: 150 } },
        workDir,
        timeoutMs: 180_000,
      }, { bins: BINS });
      assert.equal(result.outputExt, target);
      assert.match(result.note ?? '', /表格/);
      const bytes = await (await import('node:fs/promises')).readFile(result.outputPath);
      if (target === 'docx') {
        const xml = textPart(bytes, 'word/document.xml');
        assert.match(xml, /<w:tbl>/);
        assert.equal(countOf(xml, '<w:tr>'), 6);
        assert.equal(countOf(xml, '<w:tc>'), 36);
      } else {
        const sheet = textPart(bytes, 'xl/worksheets/sheet1.xml');
        assert.equal(countOf(sheet, '<row '), 6);
        const borderedCells = (sheet.match(/ s="[134]"/g) ?? []).length;
        assert.ok(borderedCells >= 30, `每个数据单元格都应有边框，实际 ${borderedCells}`);
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
