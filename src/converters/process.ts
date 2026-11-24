import { spawn } from 'node:child_process';
import { AppError } from '../http/errors.ts';

export type RunOptions = {
  cwd?: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  signal?: AbortSignal;
};

export type RunResult = { stdout: string; stderr: string; code: number };

export class CommandError extends Error {
  readonly command: string;
  readonly code: number | null;
  readonly stderr: string;

  constructor(command: string, code: number | null, stderr: string, message?: string) {
    super(message ?? `${command} 执行失败`);
    this.name = 'CommandError';
    this.command = command;
    this.code = code;
    this.stderr = stderr.slice(-8000);
  }
}

/**
 * Runs an executable without a shell. Arguments stay separate, so filenames
 * and user supplied values cannot become shell syntax.
 */
export function runCommand(bin: string, args: string[], opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;
    let settled = false;

    const append = (current: string, chunk: Buffer): string => {
      const next = current + chunk.toString('utf8');
      return next.length > 32_000 ? next.slice(-32_000) : next;
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk);
      opts.onStdout?.(chunk.toString('utf8'));
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk);
      opts.onStderr?.(chunk.toString('utf8'));
    });

    const kill = () => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {}
    };

    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, opts.timeoutMs);

    const abortHandler = () => {
      aborted = true;
      kill();
    };
    opts.signal?.addEventListener('abort', abortHandler, { once: true });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', abortHandler);
      reject(new CommandError(bin, null, '', `无法启动 ${bin}：${error.message}`));
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', abortHandler);
      if (timedOut) {
        reject(new CommandError(bin, code, stderr, `${bin} 执行超时`));
        return;
      }
      if (aborted) {
        reject(new CommandError(bin, code, stderr, '任务已取消'));
        return;
      }
      if (code !== 0) {
        reject(new CommandError(bin, code, stderr, `${bin} 执行失败`));
        return;
      }
      resolve({ stdout, stderr, code: code ?? 0 });
    });
  });
}

export function friendlyCommandError(error: unknown): string {
  if (error instanceof AppError) return error.message;
  if (error instanceof CommandError) {
    const lower = error.stderr.toLowerCase();
    if (error.message.includes('超时')) return '转换用时过长，已终止';
    if (error.message.includes('无法启动')) return '服务器缺少所需的转换组件';
    if (lower.includes('password') || lower.includes('encrypted')) return '文件受密码保护，暂不支持解密转换';
    if (lower.includes('no audio stream') || lower.includes('does not contain any stream')) return '文件中没有可提取的音轨';
    if (lower.includes('invalid data') || lower.includes('syntax error') || lower.includes('corrupt')) return '文件内容损坏或格式无效';
    if (error.message.includes('执行失败')) return '转换引擎无法处理此文件，请检查文件是否损坏或受保护';
  }
  return '转换失败，请稍后重试';
}
