import test from 'node:test';
import assert from 'node:assert/strict';
import { FORMATS, targetsFor, validateConversion } from '../src/converters/formats.ts';
import { safeFilename, parseOptions } from '../src/http/validation.ts';

const source = (ext: string, kind: keyof typeof KIND_MAP) => ({ ext, kind: KIND_MAP[kind], originalName: `sample.${ext}` });
const KIND_MAP = { image: 'image', pdf: 'pdf', document: 'document', audio: 'audio', video: 'video' } as const;

test('图片可以转换为其它图片格式和 PDF，但不能转为文档', () => {
  assert.deepEqual(validateConversion(source('png', 'image'), 'webp'), { allowed: true });
  assert.deepEqual(validateConversion(source('png', 'image'), 'pdf'), { allowed: true });
  assert.equal(validateConversion(source('png', 'image'), 'docx').allowed, false);
  assert.equal(validateConversion(source('png', 'image'), 'png').allowed, false);
});

test('PDF 只能转为可编辑文档、表格、演示、文本和图片', () => {
  for (const target of ['docx', 'odt', 'rtf', 'txt', 'xlsx', 'pptx', 'odp', 'png', 'jpg']) {
    assert.deepEqual(validateConversion(source('pdf', 'pdf'), target), { allowed: true }, target);
  }
  assert.equal(validateConversion(source('pdf', 'pdf'), 'doc').allowed, false);
  assert.equal(validateConversion(source('pdf', 'pdf'), 'mp3').allowed, false);
});

test('Office 文档不能跨应用族直接转换（需先转 PDF）', () => {
  assert.deepEqual(validateConversion(source('docx', 'document'), 'odt'), { allowed: true });
  assert.deepEqual(validateConversion(source('docx', 'document'), 'pdf'), { allowed: true });
  assert.equal(validateConversion(source('docx', 'document'), 'xlsx').allowed, false);
  assert.equal(validateConversion(source('xlsx', 'document'), 'pptx').allowed, false);
});

test('音视频只能输出音频格式', () => {
  assert.deepEqual(validateConversion(source('mp4', 'video'), 'mp3'), { allowed: true });
  assert.deepEqual(validateConversion(source('wav', 'audio'), 'flac'), { allowed: true });
  assert.equal(validateConversion(source('mp4', 'video'), 'mp4').allowed, false);
  assert.equal(validateConversion(source('mp3', 'audio'), 'pdf').allowed, false);
});

test('targetsFor 不会返回源格式自身，且过滤掉被禁止的组合', () => {
  assert.ok(!targetsFor('png', 'image').includes('png'));
  assert.ok(targetsFor('pdf', 'pdf').includes('xlsx'));
  assert.ok(!targetsFor('docx', 'document').includes('docx'));
  assert.ok(targetsFor('mp3', 'audio').includes('wav'));
});

test('每个受支持的格式都有 MIME 与中文标签', () => {
  for (const [ext, format] of Object.entries(FORMATS)) {
    assert.ok(format.label.length > 0, ext);
    assert.ok(format.mimes.length > 0, ext);
  }
});

test('文件名清洗会去掉路径分隔符与控制字符', () => {
  assert.equal(safeFilename('../../etc/passwd'), '.._.._etc_passwd');
  assert.equal(safeFilename('报告\u0000.docx'), '报告.docx');
  assert.equal(safeFilename('   '), 'file');
  assert.ok(safeFilename('a'.repeat(400)).length <= 240);
});

test('转换参数带边界校验与默认值', () => {
  assert.deepEqual(parseOptions({}, 'png'), {});
  const image = parseOptions({ image: { quality: 70, maxDimension: 1024 } }, 'webp');
  assert.equal(image.image?.quality, 70);
  assert.equal(image.image?.maxDimension, 1024);
  assert.equal(image.image?.background, '#ffffff');
  assert.equal(image.image?.preserveAlpha, true);

  const pdf = parseOptions({ pdf: { mode: 'layout', dpi: 200 } }, 'docx');
  assert.equal(pdf.pdf?.mode, 'layout');
  assert.equal(pdf.pdf?.dpi, 200);
  assert.equal(parseOptions({ pdf: {} }, 'docx').pdf?.mode, 'editable');
  assert.equal(parseOptions({ pdf: {} }, 'docx').pdf?.ocr, false);
  assert.equal(parseOptions({ pdf: { ocr: true } }, 'docx').pdf?.ocr, true);
  assert.equal(parseOptions({ pdf: { ocr: 'yes' } }, 'docx').pdf?.ocr, false);
  assert.equal(parseOptions({ pdf: {} }, 'xlsx').pdf?.sheetMode, 'single', 'PDF 转 Excel 默认单工作表');
  assert.equal(parseOptions({ pdf: { sheetMode: 'page' } }, 'xlsx').pdf?.sheetMode, 'page');

  const pdfOut = parseOptions({ document: { pdfLayout: 'layout' } }, 'pdf');
  assert.equal(pdfOut.document?.pdfLayout, 'layout');

  assert.throws(() => parseOptions({ image: { quality: 0 } }, 'png'), /图片质量/);
  assert.throws(() => parseOptions({ image: { background: 'red' } }, 'png'), /背景色/);
  assert.throws(() => parseOptions({ pdf: { mode: 'magic' } }, 'docx'), /PDF 转换模式/);
  assert.throws(() => parseOptions({ pdf: { sheetMode: 'perColumn' } }, 'xlsx'), /Excel 工作表模式/);
  assert.throws(() => parseOptions({ audio: { bitrateKbps: 1024 } }, 'mp3'), /音频码率/);
  assert.throws(() => parseOptions({ audio: { channels: '5.1' } }, 'mp3'), /声道/);
});
