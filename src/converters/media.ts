import { runCommand, CommandError } from './process.ts';
import { ConversionError, type ConvertOutcome, type ConverterInput } from './types.ts';
import { requireOutput } from './image.ts';
import { join } from 'node:path';

type ProbeStream = { codec_type?: string };
type ProbeResult = { streams?: ProbeStream[]; format?: { duration?: string } };

const AUDIO_CODEC: Record<string, string[]> = {
  mp3: ['-c:a', 'libmp3lame'],
  m4a: ['-c:a', 'aac'],
  aac: ['-c:a', 'aac'],
  flac: ['-c:a', 'flac'],
  ogg: ['-c:a', 'libvorbis'],
  wav: ['-c:a', 'pcm_s16le'],
};

export async function probeMedia(path: string, ffprobe: string, timeoutMs = 30_000): Promise<ProbeResult> {
  try {
    const result = await runCommand(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', path], { timeoutMs });
    return JSON.parse(result.stdout) as ProbeResult;
  } catch {
    throw new ConversionError('无法读取媒体文件信息，文件可能已损坏');
  }
}

export async function convertMedia(input: ConverterInput): Promise<ConvertOutcome> {
  const info = await probeMedia(input.inputPath, input.bins.ffprobe);
  if (!info.streams?.some((stream) => stream.codec_type === 'audio')) {
    throw new ConversionError('文件中没有可提取的音轨');
  }

  const audio = input.options.audio ?? { bitrateKbps: 192, sampleRate: null, channels: 'source' as const };
  const codecArgs = AUDIO_CODEC[input.target];
  if (!codecArgs) throw new ConversionError('不支持的音频目标格式');

  const duration = Math.max(0, Number(info.format?.duration ?? 0));
  const outputPath = join(input.outputDir, `${input.outputBase}.${input.target}`);
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', input.inputPath, '-map', '0:a:0', '-vn', ...codecArgs];
  if (!['flac', 'wav'].includes(input.target)) args.push('-b:a', `${audio.bitrateKbps}k`);
  if (audio.sampleRate) args.push('-ar', String(audio.sampleRate));
  if (audio.channels === 'mono') args.push('-ac', '1');
  if (audio.channels === 'stereo') args.push('-ac', '2');
  args.push('-progress', 'pipe:1', outputPath);

  let reported = 0;
  try {
    await runCommand(input.bins.ffmpeg, args, {
      timeoutMs: input.timeoutMs,
      signal: input.signal,
      onStdout: (chunk) => {
        const matches = [...chunk.matchAll(/out_time_us=(\d+)/g)];
        const match = matches.at(-1);
        if (match && duration > 0) {
          const seconds = Number(match[1]) / 1_000_000;
          const progress = Math.min(99, Math.max(reported, Math.round((seconds / duration) * 100)));
          if (progress > reported) {
            reported = progress;
            input.onProgress?.(progress);
          }
        }
      },
    });
  } catch (error) {
    if (error instanceof CommandError && /no audio/i.test(error.stderr)) throw new ConversionError('文件中没有可提取的音轨');
    throw error;
  }

  input.onProgress?.(100);
  await requireOutput(outputPath);
  return { outputPath, outputExt: input.target };
}
