import { useCallback, useEffect, useState } from 'react';
import { ApiError, request } from '../../api';
import { Alert, Loading } from '../../components/ui';

type SettingsPayload = {
  registrationOpen: boolean;
  environment: { env: string; role: string; baseUrl: string; queue: string };
};

type CleanupReport = Record<string, unknown>;

export default function Settings() {
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<CleanupReport | null>(null);

  const load = useCallback(async () => {
    try {
      setSettings(await request<SettingsPayload>('/api/admin/settings'));
    } catch (error) {
      setError(error instanceof ApiError ? error.message : '读取设置失败');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleRegistration(next: boolean) {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      await request('/api/admin/settings', { method: 'PATCH', body: { registrationOpen: next } });
      setSettings((current) => (current ? { ...current, registrationOpen: next } : current));
      setMessage(next ? '已开放注册' : '已关闭注册');
    } catch (error) {
      setError(error instanceof ApiError ? error.message : '保存设置失败');
    } finally {
      setBusy(false);
    }
  }

  async function runCleanup() {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const payload = await request<{ report: CleanupReport }>('/api/admin/cleanup', { method: 'POST' });
      setReport(payload.report);
      setMessage('清理完成');
    } catch (error) {
      setError(error instanceof ApiError ? error.message : '清理失败');
    } finally {
      setBusy(false);
    }
  }

  if (!settings) return error ? <Alert tone="error">{error}</Alert> : <Loading text="正在读取设置…" />;

  return (
    <div className="stack-lg">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {message ? <Alert tone="success">{message}</Alert> : null}

      <section className="card">
        <h2>注册</h2>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.registrationOpen}
            disabled={busy}
            onChange={(event) => void toggleRegistration(event.target.checked)}
          />
          <span>允许新用户自助注册</span>
        </label>
        <p className="muted">关闭后只有管理员可以创建账号，已登录用户不受影响。</p>
      </section>

      <section className="card">
        <h2>运行环境</h2>
        <dl className="kv kv-grid">
          <div>
            <dt>环境</dt>
            <dd>{settings.environment.env}</dd>
          </div>
          <div>
            <dt>进程角色</dt>
            <dd>{settings.environment.role}</dd>
          </div>
          <div>
            <dt>对外地址</dt>
            <dd className="mono">{settings.environment.baseUrl}</dd>
          </div>
          <div>
            <dt>队列</dt>
            <dd className="mono">{settings.environment.queue}</dd>
          </div>
        </dl>
      </section>

      <section className="card">
        <h2>维护</h2>
        <p className="muted">手动触发过期文件与失效任务的清理。定时任务通常已经自动执行。</p>
        <button type="button" className="btn btn-secondary" onClick={() => void runCleanup()} disabled={busy}>
          {busy ? '处理中…' : '立即清理过期数据'}
        </button>
        {report ? (
          <div className="report">
            <h3>清理结果</h3>
            <dl className="kv">
              {Object.entries(report).map(([key, value]) => (
                <div key={key}>
                  <dt className="mono">{key}</dt>
                  <dd>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </section>
    </div>
  );
}
