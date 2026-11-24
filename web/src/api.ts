export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null | undefined): void {
  csrfToken = token ?? null;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

type ErrorPayload = { error?: { code?: string; message?: string; details?: unknown } };

function parseError(status: number, text: string): ApiError {
  try {
    const payload = JSON.parse(text) as ErrorPayload;
    const err = payload.error;
    if (err?.message) return new ApiError(status, err.code ?? 'ERROR', err.message, err.details);
  } catch {
    /* fall through */
  }
  if (status === 401) return new ApiError(status, 'UNAUTHORIZED', '请先登录');
  if (status === 413) return new ApiError(status, 'PAYLOAD_TOO_LARGE', '上传的文件太大');
  if (status === 429) return new ApiError(status, 'QUOTA_EXCEEDED', '操作过于频繁或已超出配额');
  return new ApiError(status, 'ERROR', `请求失败（HTTP ${status}）`);
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
};

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? (options.body === undefined ? 'GET' : 'POST');
  const headers: Record<string, string> = { Accept: 'application/json' };
  const init: RequestInit = { method, credentials: 'same-origin', headers };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  if (method !== 'GET' && method !== 'HEAD' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  if (options.signal) init.signal = options.signal;

  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK_ERROR', '网络连接失败，请检查网络后重试');
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!response.ok) {
    const error = parseError(response.status, text);
    if (error.status === 401) window.dispatchEvent(new CustomEvent('convertlab:unauthorized'));
    throw error;
  }
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(response.status, 'BAD_RESPONSE', '服务器返回了无法解析的数据');
  }
}

export type UploadProgress = { loaded: number; total: number };

export function uploadForm<T>(
  path: string,
  form: FormData,
  options: { onProgress?: (progress: UploadProgress) => void; signal?: AbortSignal } = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path, true);
    xhr.withCredentials = true;
    xhr.responseType = 'text';
    xhr.setRequestHeader('Accept', 'application/json');
    if (csrfToken) xhr.setRequestHeader('X-CSRF-Token', csrfToken);

    if (options.onProgress) {
      const onProgress = options.onProgress;
      xhr.upload.onprogress = (event) => {
        onProgress({ loaded: event.loaded, total: event.total });
      };
    }
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK_ERROR', '网络连接中断，上传失败'));
    xhr.onabort = () => reject(new ApiError(0, 'ABORTED', '上传已取消'));
    xhr.onload = () => {
      const text = typeof xhr.response === 'string' ? xhr.response : '';
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve((text ? JSON.parse(text) : undefined) as T);
        } catch {
          reject(new ApiError(xhr.status, 'BAD_RESPONSE', '服务器返回了无法解析的数据'));
        }
        return;
      }
      const error = parseError(xhr.status, text);
      if (error.status === 401) window.dispatchEvent(new CustomEvent('convertlab:unauthorized'));
      reject(error);
    };
    if (options.signal) {
      options.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(form);
  });
}

export function downloadUrl(jobId: string, fileId: string): string {
  return `/api/jobs/${encodeURIComponent(jobId)}/files/${encodeURIComponent(fileId)}/download`;
}

export function zipUrl(jobId: string): string {
  return `/api/jobs/${encodeURIComponent(jobId)}/download`;
}

/** Subscribes to the job progress stream; returns a cleanup function. */
export function subscribeJob(
  jobId: string,
  handlers: { onUpdate: (payload: unknown) => void; onDone: () => void; onError?: () => void },
): () => void {
  const source = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/events`);
  let closed = false;

  source.addEventListener('update', (event) => {
    const data = (event as MessageEvent<string>).data;
    try {
      handlers.onUpdate(JSON.parse(data));
    } catch {
      /* ignore malformed frame */
    }
  });
  source.addEventListener('done', () => {
    handlers.onDone();
    close();
  });
  source.onerror = () => {
    if (closed) return;
    handlers.onError?.();
  };

  function close(): void {
    if (closed) return;
    closed = true;
    source.close();
  }

  return close;
}
