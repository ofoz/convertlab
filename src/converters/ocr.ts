import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { CommandError, runCommand } from './process.ts';
import type { ConverterInput } from './types.ts';

/**
 * Optional OCR pass for scanned PDFs.
 *
 * Only used when the caller explicitly asks for it (options.pdf.ocr) and the
 * document has no usable text layer. It rewrites the PDF with an invisible
 * Tesseract text layer (ocrmypdf --skip-text), so every downstream step —
 * table detection, text extraction, page rendering — keeps working on a
 * normal PDF and the page image itself is untouched.
 *
 * OCR is slow and memory hungry, so the page count and the wall-clock time
 * are both bounded. Every failure is downgraded to "no OCR applied", letting
 * the caller fall back to the layout (image) mode it already had.
 */

export const OCR_MAX_PAGES = 40;
const OCR_TIMEOUT_MS = 180_000;
const OCR_LANGS: string = 'chi_sim+eng';

export type OcrOutcome = {
  /** Path of the OCR'd PDF, or null when OCR was not applied. */
  path: string | null;
  /** Short user-facing explanation of what happened (always set). */
  note: string;
};

async function pdfPageCount(input: ConverterInput): Promise<number | null> {
  try {
    const result = await runCommand(input.bins.pdfinfo, [input.inputPath], { timeoutMs: 20_000 });
    const match = result.stdout.match(/^Pages:\s+(\d+)/m);
    return match ? Number.parseInt(match[1]!, 10) : null;
  } catch {
    return null;
  }
}

function isLanguageError(error: unknown): boolean {
  if (!(error instanceof CommandError)) return false;
  const text = `${error.stderr} ${error.message}`.toLowerCase();
  return text.includes('language') || text.includes('tessdata') || text.includes('chi_sim');
}

async function runOcr(
  input: ConverterInput,
  outputPath: string,
  langs: string,
  deadline: number,
): Promise<void> {
  const remaining = deadline - Date.now();
  const timeoutMs = Math.max(15_000, Math.min(OCR_TIMEOUT_MS, remaining));
  await runCommand(
    input.bins.ocrmypdf,
    [
      '--skip-text',
      '--output-type',
      'pdf',
      '--optimize',
      '0',
      '--jobs',
      '2',
      '--language',
      langs,
      input.inputPath,
      outputPath,
    ],
    {
      timeoutMs,
      signal: input.signal,
      onStderr: (chunk) => {
        if (/^\s*\d+\s*\/\s*\d+|page/i.test(chunk)) input.onProgress?.(18);
      },
    },
  );
}

export async function ocrPdf(input: ConverterInput, deadline = Date.now() + OCR_TIMEOUT_MS + 30_000): Promise<OcrOutcome> {
  if (input.options.pdf?.ocr !== true) return { path: null, note: '' };

  const pages = await pdfPageCount(input);
  if (pages !== null && pages > OCR_MAX_PAGES) {
    return { path: null, note: `PDF 共 ${pages} 页，超过 OCR 上限 ${OCR_MAX_PAGES} 页，已跳过识别` };
  }

  const outputPath = join(input.workDir, 'ocr.pdf');
  input.onProgress?.(12);
  try {
    try {
      await runOcr(input, outputPath, OCR_LANGS, deadline);
    } catch (error) {
      // A stripped-down tesseract install may ship English only; retry rather
      // than failing the whole conversion.
      if (isLanguageError(error) && OCR_LANGS !== 'eng') {
        await runOcr(input, outputPath, 'eng', deadline);
      } else {
        throw error;
      }
    }
  } catch (error) {
    if (error instanceof CommandError && error.code === 6) {
      return { path: null, note: '该 PDF 每页都已有文本层，未重复识别' };
    }
    if (input.signal?.aborted) throw error;
    if (error instanceof CommandError && error.message.includes('超时')) {
      return { path: null, note: 'OCR 用时过长已中止，已回退为版式模式' };
    }
    if (error instanceof CommandError && error.message.includes('无法启动')) {
      return { path: null, note: '服务器未安装 OCR 组件，已回退为版式模式' };
    }
    const detail = error instanceof CommandError ? `${error.stderr || error.message}`.trim().split('\n').slice(-1)[0] : '';
    return {
      path: null,
      note: `OCR 未能完成，已回退为版式模式${detail ? `（${detail.slice(0, 120)}）` : ''}`,
    };
  }

  const info = await stat(outputPath).catch(() => null);
  if (!info || info.size === 0) {
    return { path: null, note: 'OCR 没有生成有效结果，已回退为版式模式' };
  }
  input.onProgress?.(30);
  return { path: outputPath, note: '已对扫描页执行 OCR（Tesseract 中文+英文），识别结果需人工校对' };
}
