import { useState } from 'react';
import { ApiError, request } from '../api';
import { AuthScene } from './LoginPage';
import { AuthPasswordField } from '../components/AuthPasswordField';
import { useAuthMascotMode } from '../components/useAuthMascotMode';
import { useSession } from '../session';
import { formatBytes, formatDateTime } from '../utils';

function QuotaRow({ label, used, limit }: { label: string; used: number; limit: number }) {
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <li className="sx-quota-row">
      <div className="sx-quota-head">
        <span>{label}</span>
        <span className="muted">
          {formatBytes(used)} / {formatBytes(limit)}
        </span>
      </div>
      <progress className="progress" value={percent} max={100} aria-label={`${label}用量`} />
    </li>
  );
}

export default function AccountPage() {
  const { user, usage, quotas, refresh } = useSession();
  const dayLabel = (() => {
    if (!usage?.day) return '—';
    const day = new Date(usage.day);
    return Number.isNaN(day.getTime())
      ? usage.day
      : `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  })();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [currentVisible, setCurrentVisible] = useState(false);
  const [nextVisible, setNextVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [focusedPassword, setFocusedPassword] = useState<'current' | 'next' | 'confirm' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mascotMode = useAuthMascotMode(
    focusedPassword,
    focusedPassword === 'current'
      ? currentVisible
      : focusedPassword === 'next'
        ? nextVisible
        : confirmVisible,
  );

  async function onChangePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (next !== confirm) {
      setError('两次输入的新密码不一致');
      return;
    }
    if (next.length < 8) {
      setError('新密码至少需要 8 个字符');
      return;
    }
    setBusy(true);
    try {
      const payload = await request<{ ok: boolean; revokedSessions: number }>('/api/auth/password', {
        body: { currentPassword: current, newPassword: next },
      });
      setSuccess(`密码已更新，已退出 ${payload.revokedSessions} 个其他会话。`);
      setCurrent('');
      setNext('');
      setConfirm('');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '修改密码失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="main-content" className="app-container sx-auth-page" tabIndex={-1}>
      <div className="surface sx-auth-layout" data-auth-scene="account">
        <AuthScene
          image="whale-serious.webp"
          message="需要更新账号信息？在这里就好。"
          mascotMode={mascotMode}
        />
        <section className="sx-auth-card sx-account-card">
          <div className="sx-auth-heading">
            <span className="eyebrow">个人设置</span>
            <h1>账号设置</h1>
            <p className="muted">查看账号信息与今日用量，或设置新密码。</p>
          </div>

          <dl className="sx-account-meta">
            <div>
              <dt>邮箱地址</dt>
              <dd>{user?.email}</dd>
            </div>
            <div>
              <dt>角色</dt>
              <dd>{user?.role === 'admin' ? '管理员' : '普通用户'}</dd>
            </div>
            <div>
              <dt>注册时间</dt>
              <dd>{formatDateTime(user?.createdAt ?? null)}</dd>
            </div>
            <div>
              <dt>最近登录</dt>
              <dd>{formatDateTime(user?.lastLoginAt ?? null)}</dd>
            </div>
          </dl>

          <div className="sx-account-usage">
            <h2>
              今日用量 <small className="muted">{dayLabel}</small>
            </h2>
            {usage && quotas ? (
              <ul className="sx-quota-list">
                <QuotaRow label="任务次数" used={usage.jobs} limit={quotas.jobs} />
                <QuotaRow label="上传流量" used={usage.uploadBytes} limit={quotas.uploadBytes} />
                <QuotaRow label="输出流量" used={usage.outputBytes} limit={quotas.outputBytes} />
              </ul>
            ) : (
              <p className="muted">暂无用量数据</p>
            )}
          </div>

          <div className="sx-account-divider" role="presentation" />

          <form className="sx-form" onSubmit={onChangePassword}>
            <div className="sx-auth-heading sx-account-form-heading">
              <h2>修改密码</h2>
              <p className="muted">更改前请验证当前密码，其他设备的登录会被退出。</p>
            </div>
            {error ? (
              <div className="sx-form-error" role="alert">
                <p>{error}</p>
              </div>
            ) : null}
            {success ? (
              <div className="sx-form-notice" role="status">
                <p>{success}</p>
              </div>
            ) : null}
            <AuthPasswordField
              label="当前密码"
              placeholder="验证当前密码"
              autoComplete="current-password"
              value={current}
              visible={currentVisible}
              onChange={(event) => setCurrent(event.target.value)}
              onFocus={() => setFocusedPassword('current')}
              onBlur={() => setFocusedPassword(null)}
              onToggle={() => setCurrentVisible((visible) => !visible)}
            />
            <AuthPasswordField
              label={<><span>新密码 <small>（至少 8 位）</small></span></>}
              placeholder="输入新密码"
              autoComplete="new-password"
              value={next}
              visible={nextVisible}
              onChange={(event) => setNext(event.target.value)}
              onFocus={() => setFocusedPassword('next')}
              onBlur={() => setFocusedPassword(null)}
              onToggle={() => setNextVisible((visible) => !visible)}
            />
            <AuthPasswordField
              label="确认新密码"
              placeholder="再次输入新密码"
              autoComplete="new-password"
              value={confirm}
              visible={confirmVisible}
              onChange={(event) => setConfirm(event.target.value)}
              onFocus={() => setFocusedPassword('confirm')}
              onBlur={() => setFocusedPassword(null)}
              onToggle={() => setConfirmVisible((visible) => !visible)}
            />
            <button type="submit" className="sx-submit btn-primary" disabled={busy}>
              {busy ? '正在保存…' : '保存更改'}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
