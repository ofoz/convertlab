import test from 'node:test';
import assert from 'node:assert/strict';
import { detectGridTables, parseSvgPages } from '../src/converters/pdf-tables.ts';

const lines = (paint: (style: string) => string) => `
<path ${paint('M 0 0 L 100 0')} d="M 0 0 L 100 0"/>
<path ${paint('M 0 20 L 100 20')} d="M 0 20 L 100 20"/>
<path ${paint('M 0 40 L 100 40')} d="M 0 40 L 100 40"/>
<path ${paint('M 0 0 L 0 40')} d="M 0 0 L 0 40"/>
<path ${paint('M 50 0 L 50 40')} d="M 50 0 L 50 40"/>
<path ${paint('M 100 0 L 100 40')} d="M 100 0 L 100 40"/>`;

const stylePaint = (d: string) => `style="fill:none;stroke:rgb(0%,0%,0%);stroke-width:0.75;" d="${d}"`;
const attributePaint = (d: string) => `fill="none" stroke="rgb(0,0,0)" d="${d}"`;

test('Poppler 22/26 两种 SVG 写法都能提取表格线', () => {
  const svg = `<svg>
  <defs><path style="stroke:rgb(0%,0%,0%)" d="M 0 0 L 999 0"/></defs>
  <page><g transform="matrix(1,0,0,1,10,20)">${lines(stylePaint)}</g></page>
  <page><g transform="matrix(1,0,0,1,10,20)">${lines(attributePaint)}</g></page>
  </svg>`;

  const pages = parseSvgPages(svg);
  assert.equal(pages.length, 2);
  assert.equal(pages[0]!.segments.length, 6, 'style 形式的线段不能被丢弃');
  assert.equal(pages[1]!.segments.length, 6, '属性形式的线段仍应保留');

  const words = [
    { text: 'A1', x0: 30, y0: 25, x1: 40, y1: 35 },
    { text: 'B1', x0: 80, y0: 25, x1: 90, y1: 35 },
    { text: 'A2', x0: 30, y0: 45, x1: 40, y1: 55 },
    { text: 'B2', x0: 80, y0: 45, x1: 90, y1: 55 },
  ];

  for (const page of pages) {
    const tables = detectGridTables(page.segments, words);
    assert.equal(tables.length, 1);
    assert.deepEqual(tables[0]!.rows, [
      ['A1', 'B1'],
      ['A2', 'B2'],
    ]);
  }
});
