import type { ConversionOptions } from './formats.ts';

export type Bins = {
  soffice: string;
  ffmpeg: string;
  ffprobe: string;
  gs: string;
  pdftoppm: string;
  pdftotext: string;
  pdftocairo: string;
  pdfinfo: string;
  ocrmypdf: string;
  tesseract: string;
};

export type ConverterInput = {
  inputPath: string;
  outputDir: string;
  /** Base name (without extension) used for generated files. */
  outputBase: string;
  sourceExt: string;
  target: string;
  options: ConversionOptions;
  workDir: string;
  timeoutMs: number;
  bins: Bins;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
};

export type ConvertOutcome = { outputPath: string; outputExt: string; note?: string };

export class ConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConversionError';
  }
}
