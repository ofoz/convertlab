import { useCallback, useEffect, useState } from 'react';
import { ApiError, request } from '../../api';
import { Alert, Field, Loading, Modal, Pagination, StatusBadge } from '../../components/ui';
import type { AdminUser, Job } from '../../types';
import { formatBytes, formatDateTime } from '../../utils';

const LIMIT = 20;

export default function Users() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'user' | 'admin'>('user');

  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [resetPassword, setResetPassword] = useState('');

  const [jobsTarget, setJobsTarget] = useState<AdminUser | null>(null);
  const [userJobs, setUserJobs] = useState<Job[] | null>(null);

  const load = useCallback(
    async (nextOffset: number, searchText: string) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ limit: String(LIMIT), offset: String(nextOffset) });
        if (searchText) params.set('search', searchText);
        const payload = await request<{ users: AdminUser[]; total: number }>(`/api/admin/users?${params.toString()}`);
        setUsers(payload.users);
        setTotal(payload.total);
        setOffset(nextOffset);
      } catch (error) {
        setError(error instanceof ApiError ? error.message : '读取用户列表失败');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(0, query);
  }, [load, query]);

  async function patchUser(user: AdminUser, body: Record<string, unknown>, success: string) {
    setError(null);
    setMessage(null);
    try {
      await request(`/api/admin/users/${user.id}`, { method: 'PATCH', body });
      setMessage(success);
      await load(offset, query);
    } catch (error) {
      setError(error instanceof ApiError ? error.message : '操作失败');
    }
  }

  async function createUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await request('/api/admin/users', { body: { email: newEmail.trim(), password: newPassword, role: newRole } });
      setMessage(`已创建用户 ${newEmail.trim()}`);
      setCreateOpen(false);
      setNewEmail('');
      setNewPassword('');
      setNewRole('user');
      await load(0, query);
    } catch (error) {
      setError(error instanceof ApiError ? error.message : '创建用户失败');
    }
  }

  async function submitReset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resetTarget) return;
    setError(null);
    try {
      const payload = await request<{ revokedSessions: number }>(`/api/admin/users/${resetTarget.id}/password`, {
        body: { password: resetPassword },
      });
      setMessage(`已重置 ${resetTarget.email} 的密码，撤销 ${payload.revokedSessions} 个会话`);
      setResetTarget(null);
      setResetPassword('');
    } catch (error) {
      setError(error instanceof ApiError ? error.message : '重置密码失败');
    }
  }

  async function removeUser(user: AdminUser) {
    if (!window.confirm(`确定删除用户 ${user.email} 吗？该用户的全部任务与文件都会被删除。`)) return;
    setError(null);
    try {
      await request(`/api/admin/users/${user.id}`, { method: 'DELETE' });
      setMessage(`已删除用户 ${user.email}`);
      await load(offset, query);
    } catch (error) {
      setError(error instanceof ApiError ? error.message : '删除用户失败');
    }
  }

  async function openJobs(user: AdminUser) {
    setJobsTarget(user);
    setUserJobs(null);
    try {
      const payload = await request<{ jobs: Job[] }>(`/api/admin/users/${user.id}/jobs?limit=20&offset=0`);
      setUserJobs(payload.jobs);
    } catch {
      setUserJobs([]);
    }
  }

  return (
    <div className="stack-lg">
      <div className="toolbar">
        <form
          className="search"
          onSubmit={(event) => {
            event.preventDefault();
            setQuery(search.trim());
          }}
        >
          <input
            className="input"
            type="search"
            placeholder="按邮箱搜索"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button type="submit" className="btn btn-secondary">
            搜索
          </button>
        </form>
        <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
          新建用户
        </button>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {message ? <Alert tone="success">{message}</Alert> : null}
      {loading ? <Loading text="正在读取用户…" /> : null}

      {!loading ? (
        <section className="card">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>邮箱</th>
                  <th>角色</th>
                  <th>状态</th>
                  <th>今日任务</th>
                  <th>累计任务</th>
                  <th>注册时间</th>
                  <th>最近登录</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="muted">
                      没有匹配的用户
                    </td>
                  </tr>
                ) : null}
                {users.map((user) => (
                  <tr key={user.id}>
                    <td className="cell-email">{user.email}</td>
                    <td>{user.role === 'admin' ? '管理员' : '普通用户'}</td>
                    <td>{user.status === 'active' ? '正常' : `已停用${user.disabledReason ? `（${user.disabledReason}）` : ''}`}</td>
                    <td>
                      {user.usage.jobs} / 上传 {formatBytes(user.usage.uploadBytes)}
                    </td>
                    <td>{user.jobCount}</td>
                    <td>{formatDateTime(user.createdAt)}</td>
                    <td>{formatDateTime(user.lastLoginAt)}</td>
                    <td className="cell-actions">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void openJobs(user)}>
                        任务
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          setResetTarget(user);
                          setResetPassword('');
                        }}
                      >
                        重置密码
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          void patchUser(
                            user,
                            { role: user.role === 'admin' ? 'user' : 'admin' },
                            `已${user.role === 'admin' ? '取消' : '授予'} ${user.email} 管理员权限`,
                          )
                        }
                      >
                        {user.role === 'admin' ? '取消管理员' : '设为管理员'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          void patchUser(
                            user,
                            { status: user.status === 'active' ? 'disabled' : 'active' },
                            `已${user.status === 'active' ? '停用' : '启用'} ${user.email}`,
                          )
                        }
                      >
                        {user.status === 'active' ? '停用' : '启用'}
                      </button>
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => void removeUser(user)}>
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination total={total} limit={LIMIT} offset={offset} onChange={(next) => void load(next, query)} />
        </section>
      ) : null}

      <Modal
        open={createOpen}
        title="新建用户"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setCreateOpen(false)}>
              取消
            </button>
            <button type="submit" form="create-user-form" className="btn btn-primary">
              创建
            </button>
          </>
        }
      >
        <form id="create-user-form" className="stack" onSubmit={createUser}>
          <Field label="邮箱" htmlFor="newEmail">
            <input
              id="newEmail"
              className="input"
              type="email"
              required
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
            />
          </Field>
          <Field label="初始密码" htmlFor="newPassword" hint="至少 8 个字符，创建后请提醒用户尽快修改">
            <input
              id="newPassword"
              className="input"
              type="password"
              required
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </Field>
          <Field label="角色" htmlFor="newRole">
            <select
              id="newRole"
              className="input"
              value={newRole}
              onChange={(event) => setNewRole(event.target.value === 'admin' ? 'admin' : 'user')}
            >
              <option value="user">普通用户</option>
              <option value="admin">管理员</option>
            </select>
          </Field>
        </form>
      </Modal>

      <Modal
        open={resetTarget !== null}
        title={`重置密码：${resetTarget?.email ?? ''}`}
        onClose={() => setResetTarget(null)}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setResetTarget(null)}>
              取消
            </button>
            <button type="submit" form="reset-password-form" className="btn btn-primary">
              重置
            </button>
          </>
        }
      >
        <form id="reset-password-form" className="stack" onSubmit={submitReset}>
          <Field label="新密码" htmlFor="resetPassword" hint="重置后该用户的所有会话都会失效">
            <input
              id="resetPassword"
              className="input"
              type="password"
              required
              value={resetPassword}
              onChange={(event) => setResetPassword(event.target.value)}
            />
          </Field>
        </form>
      </Modal>

      <Modal open={jobsTarget !== null} title={`任务记录：${jobsTarget?.email ?? ''}`} onClose={() => setJobsTarget(null)}>
        {userJobs === null ? <Loading text="正在读取任务…" /> : null}
        {userJobs && userJobs.length === 0 ? <p className="muted">该用户还没有任务记录。</p> : null}
        {userJobs && userJobs.length > 0 ? (
          <ul className="job-list">
            {userJobs.map((job) => (
              <li key={job.id} className="job-item">
                <div className="job-item-head">
                  <div>
                    <p className="job-target">
                      {job.totalFiles} 个文件 → {job.target.toUpperCase()}
                    </p>
                    <p className="job-sub">{formatDateTime(job.createdAt)}</p>
                  </div>
                  <StatusBadge status={job.status} />
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </Modal>
    </div>
  );
}
