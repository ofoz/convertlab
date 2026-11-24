import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePgm, rasterRules, rulesToSegments, detectImageTableLines } from '../src/converters/pdf-image-tables.ts';
import { detectGridTables, parseSvgPages } from '../src/converters/pdf-tables.ts';
import { BINS, fixture, POppler } from './testkit.ts';

type Canvas = { width: number; height: number; pixels: Uint8Array };

/** Minimal test canvas that writes the same binary PGM pdftoppm produces. */
function canvas(width: number, height: number): Canvas {
  const pixels = new Uint8Array(width * height).fill(255);
  return { width, height, pixels };
}

function fillRect(image: Canvas, x0: number, y0: number, x1: number, y1: number, value = 0): void {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) image.pixels[y * image.width + x] = value;
  }
}

function toPgm(image: Canvas): Buffer {
  const header = Buffer.from(`P5\n# synthetic test page\n${image.width} ${image.height}\n255\n`, 'latin1');
  return Buffer.concat([header, Buffer.from(image.pixels)]);
}

/** A page with one bordered 3x2 table and a few text-like blobs around it. */
function tablePage(): Canvas {
  const image = canvas(400, 300);
  for (const y of [50, 150, 250]) fillRect(image, 40, y, 360, y + 1);
  for (const x of [40, 200, 360]) fillRect(image, x, 50, x + 1, 250);
  // Glyph-sized blobs inside the cells and above the table: dark, but never a rule.
  const blobs: Array<[number, number]> = [[60, 80], [220, 80], [60, 190], [220, 190], [60, 20]];
  for (const [x, y] of blobs) {
    for (let row = 0; row < 5; row += 1) fillRect(image, x, y + row * 5, x + 24, y + row * 5 + 2);
  }
  // A filled bar: long and thin enough to look like a rule, but far too dense.
  fillRect(image, 100, 270, 160, 275);
  return image;
}

test('PGM 解析支持注释行并保留像素值', () => {
  const image = tablePage();
  const parsed = parsePgm(toPgm(image));
  assert.ok(parsed);
  assert.equal(parsed.width, 400);
  assert.equal(parsed.height, 300);
  assert.equal(parsed.data.length, 400 * 300);
  assert.equal(parsed.data[50 * 400 + 40], 0, '表格线像素应为纯黑');
  assert.equal(parsed.data[0], 255, '空白区域应为纯白');
});

test('损坏或非 PGM 输入返回 null 而不是抛错', () => {
  assert.equal(parsePgm(Buffer.from('P6\n1 1\n255\n\0\0\0', 'latin1')), null);
  assert.equal(parsePgm(Buffer.from('P5\n400 300\n255\n', 'latin1')), null);
  assert.equal(parsePgm(Buffer.alloc(0)), null);
});

test('位图上的表格线被提取为横竖规则，字形和色块不算线', () => {
  const image = tablePage();
  const rules = rasterRules({ width: image.width, height: image.height, data: image.pixels });

  const horizontalLevels = [...new Set(rules.horizontals.map((line) => line.y))].sort((a, b) => a - b);
  assert.deepEqual(
    horizontalLevels.filter((y) => y >= 48 && y <= 52 || y >= 148 && y <= 152 || y >= 248 && y <= 252),
    horizontalLevels,
    '只应命中三条表格横线',
  );
  assert.ok(horizontalLevels.some((y) => Math.abs(y - 50) <= 2));
  assert.ok(horizontalLevels.some((y) => Math.abs(y - 150) <= 2));
  assert.ok(horizontalLevels.some((y) => Math.abs(y - 250) <= 2));
  assert.equal(horizontalLevels.some((y) => y >= 268 && y <= 277), false, '过密的色块不是表格线');

  const verticalLevels = [...new Set(rules.verticals.map((line) => line.x))].sort((a, b) => a - b);
  for (const expected of [40, 200, 360]) {
    assert.ok(verticalLevels.some((x) => Math.abs(x - expected) <= 2), `应识别 x=${expected} 的竖线`);
  }
});

test('像素规则换算成 PDF 点后可直接喂给网格装配', () => {
  const image = tablePage();
  const rules = rasterRules({ width: image.width, height: image.height, data: image.pixels });
  const segments = rulesToSegments(rules, 0.5, 0.5);
  assert.ok(segments.length >= 6);

  // 400x300 px 页面按 0.5 缩放 => 200x150 pt；三条横线落在 25/75/125 pt。
  // A rule is two pixels thick, so the raw segments come in pairs.
  const ys: number[] = [];
  for (const value of segments.filter((s) => Math.abs(s.y1 - s.y0) < 0.001).map((s) => s.y0).sort((a, b) => a - b)) {
    if (ys.length === 0 || Math.abs(value - ys[ys.length - 1]!) > 2) ys.push(value);
  }
  assert.deepEqual(ys.map((value) => Math.round(value)), [25, 75, 125]);

  const words = [
    { text: 'A1', x0: 30, y0: 30, x1: 60, y1: 40 },
    { text: 'B1', x0: 110, y0: 30, x1: 140, y1: 40 },
    { text: 'A2', x0: 30, y0: 80, x1: 60, y1: 90 },
    { text: 'B2', x0: 110, y0: 80, x1: 140, y1: 90 },
  ];
  const tables = detectGridTables(segments, words);
  assert.equal(tables.length, 1);
  assert.deepEqual(tables[0]!.rows, [
    ['A1', 'B1'],
    ['A2', 'B2'],
  ]);
});

test('同一页上共享左右边距的堆叠表格不会被并成一张', () => {
  // 三张上下堆叠的表格共用左右边距：竖线在 x 上完全重合，但每一张都是独立笔画。
  const segments: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  const words: Array<{ text: string; x0: number; y0: number; x1: number; y1: number }> = [];
  const tops = [40, 140, 240];
  for (const [index, top] of tops.entries()) {
    const bottom = top + 60;
    for (const y of [top, top + 30, bottom]) segments.push({ x0: 60, y0: y, x1: 340, y1: y });
    for (const x of [60, 200, 340]) segments.push({ x0: x, y0: top, x1: x, y1: bottom });
    for (const y of [top + 5, top + 35]) {
      words.push({ text: `a${index}${y}`, x0: 70, y0: y, x1: 120, y1: y + 10 });
      words.push({ text: `b${index}${y}`, x0: 210, y0: y, x1: 260, y1: y + 10 });
    }
  }
  const tables = detectGridTables(segments, words);
  assert.equal(tables.length, 3, '三张表应各自成表');
  assert.deepEqual(
    tables.map((table) => Math.round(table.bounds.y0)),
    tops,
  );
  for (const table of tables) assert.equal(table.rows.length, 2);
});

test('整页位图的 SVG 被识别为扫描页', () => {
  const svg = `<svg width="595pt" height="842pt" viewBox="0 0 595 842">
  <defs><image id="source-7" x="0" y="0" width="595" height="842" xlink:href="data:image/jpeg;base64,AAAA"/></defs>
  <use xlink:href="#source-7"/>
  </svg>`;
  const pages = parseSvgPages(svg);
  assert.equal(pages.length, 1, '单页 PDF 的 SVG 没有 <page> 包装，也应算作一页');
  assert.equal(pages[0]!.segments.length, 0);
  assert.equal(Math.round(pages[0]!.imageArea), 595 * 842);
});

test('矢量页面上的表格线仍然照常工作（imageArea 为 0）', () => {
  const svg = `<svg><page><g>${[0, 20, 40]
    .map((y) => `<path style="fill:none;stroke:rgb(0%,0%,0%)" d="M 0 ${y} L 100 ${y}"/>`)
    .join('')}${[0, 50, 100]
    .map((x) => `<path style="fill:none;stroke:rgb(0%,0%,0%)" d="M ${x} 0 L ${x} 40"/>`)
    .join('')}</g></page></svg>`;
  const pages = parseSvgPages(svg);
  assert.equal(pages.length, 1);
  assert.equal(pages[0]!.segments.length, 6);
  assert.equal(pages[0]!.imageArea, 0);
});

test('真实 PDF 渲染后能还原出同样的表格网格', { skip: POppler ? false : '需要 Poppler pdftoppm' }, async () => {
  const input = {
    inputPath: fixture('table-bordered.pdf'),
    outputDir: fixture('.'),
    outputBase: 'bordered',
    sourceExt: 'pdf',
    target: 'docx',
    options: {},
    workDir: fixture('.'),
    timeoutMs: 60_000,
    bins: BINS,
  };
  const segments = (await detectImageTableLines(input, [{ index: 1, width: 612, height: 792 }])).get(1) ?? [];
  assert.ok(segments.length > 0, '渲染后的页面应能提取出表格线');

  const levels = (values: number[]): number[] => {
    const sorted = [...values].sort((a, b) => a - b);
    const out: number[] = [];
    for (const value of sorted) {
      if (out.length === 0 || Math.abs(value - out[out.length - 1]!) > 2) out.push(value);
    }
    return out;
  };
  const xs = levels(segments.filter((s) => Math.abs(s.x1 - s.x0) < 0.01).map((s) => s.x0));
  const ys = levels(segments.filter((s) => Math.abs(s.y1 - s.y0) < 0.01).map((s) => s.y0));
  assert.equal(xs.length, 7, '6 列应有 7 条竖线');
  assert.equal(ys.length, 7, '6 行应有 7 条横线');
  // The vector pass on this file reports x 58.1..553.9 / y 111..255.4; the
  // rendered bitmap must land on the same box within a fraction of a point.
  assert.ok(Math.abs(xs[0]! - 58.1) < 2, `左边框位置偏差过大：${xs[0]}`);
  assert.ok(Math.abs(xs[xs.length - 1]! - 553.9) < 2, `右边框位置偏差过大：${xs[xs.length - 1]}`);
  assert.ok(Math.abs(ys[0]! - 111) < 2, `上边框位置偏差过大：${ys[0]}`);
  assert.ok(Math.abs(ys[ys.length - 1]! - 255.4) < 2, `下边框位置偏差过大：${ys[ys.length - 1]}`);
});
