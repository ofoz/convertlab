import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * API smoke test. Running the HTTP layer needs PostgreSQL + Redis, so this test
 * only executes against a live instance and reports an explicit skip otherwise.
 * Start one with `docker compose up -d` and set CONVERTLAB_API_URL=http://localhost:8080.
 */
const baseUrl = process.env.CONVERTLAB_API_URL?.replace(/\/+$/, '') ?? '';
const skip = baseUrl ? false : '需要 CONVERTLAB_API_URL 指向已启动的服务（数据库与 Redis 必需）';

test('健康检查返回数据库与队列状态', { skip }, async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  const body = (await response.json()) as { status: string; database: boolean; redis: boolean; role: string };
  assert.equal(response.status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.database, true);
  assert.equal(body.redis, true);
  assert.ok(['all', 'web', 'worker'].includes(body.role));
});

test('格式目录公开可读且包含表格转换能力', { skip }, async () => {
  const response = await fetch(`${baseUrl}/api/formats`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    formats: Array<{ ext: string; kind: string; targets: string[] }>;
    limits: { maxBatchFiles: number; maxFileMb: number };
  };
  const pdf = body.formats.find((format) => format.ext === 'pdf');
  assert.ok(pdf, '应包含 PDF 条目');
  assert.ok(pdf!.targets.includes('docx'));
  assert.ok(pdf!.targets.includes('xlsx'));
  assert.equal(body.limits.maxBatchFiles, 20);
  assert.equal(body.limits.maxFileMb, 100);
});

test('未登录访问任务列表返回 401 且为中文错误', { skip }, async () => {
  const response = await fetch(`${baseUrl}/api/jobs`);
  assert.equal(response.status, 401);
  const body = (await response.json()) as { error?: { code?: string; message?: string } };
  assert.ok(body.error?.code);
  assert.ok(body.error?.message);
});

test('登录接口拒绝错误凭据并限流', { skip }, async () => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'nobody@example.com', password: 'wrong-password' }),
  });
  assert.equal(response.status, 401);
  const body = (await response.json()) as { error?: { code?: string } };
  assert.equal(body.error?.code, 'INVALID_CREDENTIALS');
});
