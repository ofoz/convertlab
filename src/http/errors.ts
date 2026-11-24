export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const Errors = {
  badRequest: (message: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', message, details),
  unauthorized: (message = '请先登录') => new AppError(401, 'UNAUTHORIZED', message),
  forbidden: (message = '无权执行此操作') => new AppError(403, 'FORBIDDEN', message),
  notFound: (message = '资源不存在') => new AppError(404, 'NOT_FOUND', message),
  conflict: (message: string) => new AppError(409, 'CONFLICT', message),
  quota: (message: string, details?: unknown) => new AppError(429, 'QUOTA_EXCEEDED', message, details),
  tooLarge: (message: string) => new AppError(413, 'PAYLOAD_TOO_LARGE', message),
  unsupported: (message: string) => new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', message),
  internal: (message = '服务器暂时无法完成操作') => new AppError(500, 'INTERNAL_ERROR', message),
};

export function errorPayload(error: AppError, requestId?: string) {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
      ...(requestId ? { requestId } : {}),
    },
  };
}
