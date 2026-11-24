import { useState } from 'react';
import { ApiError, request } from '../api';
import { navigate, safeNext } from '../router';
import { useSession } from '../session';
import type { AuthPayload } from '../session';

type Mode = 'login' | 'register';

const SCENES: Record<Mode, { image: string; message: string }> = {
  login: { image: 'whale-cheerful.webp', message: '回来啦！今天想转换什么文件？' },
  register: { image: 'whale-starry.webp', message: '初次见面，我是大肥鱼！' },
};

export function AuthScene({
  image,
  message,
}: {
  image: string;
  message: string;
}) {
  return (
    <aside className="sx-auth-scene" aria-label="工坊接待处">
      <div className="sx-auth-arch" aria-hidden="true" />
      <div className="sx-auth-greeting">
        <strong>工坊接待处</strong>
        <p>{message}</p>
      </div>
      <div className="sx-auth-actor" aria-hidden="true">
        <img
          className="sx-auth-character"
          data-auth-mascot
          src={`/characters/display/384/${image}`}
          alt=""
        />
      </div>
      <div className="sx-auth-counter" aria-hidden="true">
        <span>大肥鱼 · 接待</span>
      </div>
    </aside>
  );
}

export default function LoginPage({ next = null, mode }: { next?: string | null; mode: Mode }) {
  const { applyAuth, registrationOpen } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const register = mode === 'register';
  const scene = SCENES[mode];
  const returnTo = safeNext(next);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (register && password !== confirm) {
      setError('两次输入的密码不一致，请重新确认。');
      return;
    }
    if (register && password.length < 8) {
      setError('密码至少需要 8 个字符。');
      return;
    }
    setBusy(true);
    try {
      const path = register ? '/api/auth/register' : '/api/auth/login';
      const payload = await request<AuthPayload>(path, { body: { email: email.trim(), password } });
      applyAuth(payload);
      navigate(returnTo ?? '/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '提交失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="main-content" className="app-container sx-auth-page" tabIndex={-1}>
      <div className="surface sx-auth-layout" data-auth-scene={mode}>
        <AuthScene image={scene.image} message={scene.message} />
        <section className="sx-auth-card">
          <div className="sx-auth-heading">
            <span className="eyebrow">{register ? '新用户' : '欢迎回来'}</span>
            <h1>{register ? '创建账号' : '登录账号'}</h1>
            <p className="muted">
              {register ? '创建账号以保存并查看你的转换任务。' : '登录后继续管理你的转换任务。'}
            </p>
          </div>
          <form className="sx-form" onSubmit={onSubmit}>
            {error ? (
              <div className="sx-form-error" role="alert">
                <p>{error}</p>
              </div>
            ) : null}
            {register && !registrationOpen ? (
              <div className="sx-form-error" role="alert">
                <p>当前未开放注册，请联系管理员开通账号。</p>
              </div>
            ) : null}
            <label className="sx-labeled-field">
              <span>邮箱地址</span>
              <input
                className="form-field"
                type="email"
                name="email"
                placeholder="name@example.com"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="sx-labeled-field">
              <span>密码</span>
              <input
                className="form-field"
                type="password"
                name="password"
                placeholder={register ? '设置密码（至少 8 位）' : '输入密码'}
                autoComplete={register ? 'new-password' : 'current-password'}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {register ? (
              <label className="sx-labeled-field">
                <span>确认密码</span>
                <input
                  className="form-field"
                  type="password"
                  name="confirmPassword"
                  placeholder="再次输入密码"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                />
              </label>
            ) : null}
            <button
              type="submit"
              className="sx-submit btn-primary"
              disabled={busy || (register && !registrationOpen)}
            >
              {busy ? '正在提交…' : register ? '注册' : '登录'}
            </button>
            {register ? (
              <p className="sx-auth-switch muted">
                已经有账号？{' '}
                <a href={returnTo ? `#/login?next=${encodeURIComponent(returnTo)}` : '#/login'}>返回登录</a>
              </p>
            ) : (
              <p className="sx-auth-switch muted">
                {registrationOpen ? (
                  <>
                    还没有账号？{' '}
                    <a
                      href={
                        returnTo
                          ? `#/login?next=${encodeURIComponent(returnTo)}&mode=register`
                          : '#/login?mode=register'
                      }
                    >
                      创建账号
                    </a>
                  </>
                ) : (
                  '当前未开放注册，请联系管理员开通账号。'
                )}
              </p>
            )}
          </form>
        </section>
      </div>
    </main>
  );
}
