import type { ConversionOptions } from './formats.ts';
import type { Bins, ConvertOutcome, ConverterInput } from './types.ts';
import { convertImage } from './image.ts';
import { convertDocument, convertPdf } from './documents.ts';
import { convertMedia } from './media.ts';
import { ConversionError } from './types.ts';

export type ConversionTask = {
  inputPath: string;
  outputDir: string;
  outputBase: string;
  sourceExt: string;
  sourceKind: 'image' | 'document' | 'audio' | 'video' | 'pdf';
  target: string;
  options: ConversionOptions;
  workDir: string;
  timeoutMs: number;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
};

export type ConverterPorts = { bins: Bins };

export async function runConversion(task: ConversionTask, ports: ConverterPorts): Promise<ConvertOutcome> {
  const common: ConverterInput = { ...task, bins: ports.bins };
  if (task.sourceKind === 'image') return convertImage(common);
  if (task.sourceKind === 'pdf') return convertPdf(common);
  if (task.sourceKind === 'document') return convertDocument(common);
  if (task.sourceKind === 'audio' || task.sourceKind === 'video') return convertMedia(common);
  throw new ConversionError('无法识别此文件类型');
}
