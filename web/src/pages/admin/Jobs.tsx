import { useCallback, useEffect, useState } from 'react';
import { ApiError, request } from '../../api';
import { Alert, Loading, Modal, Pagination, ProgressBar, StatusBadge } from '../../components/ui';
import type { AdminJob, Job } from '../../types';
import { formatBytes, formatDateTime, relativeTime } from '../../utils';

const LIMIT = 20;
const STATUSES = ['', 'queued', 'processing', 'success', 'partial', 'failed', 'cancelled'];

export default function Jobs() {
  const [jobs, setJobs] = useState<AdminJob[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [detail, setDetail] = useState<{ job: Job; email: string | null } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async (nextOffset: number, statusValue: string, searchValue: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(LIMIT), offset: String(nextOffset) });
      if (statusValue) params.set('status', statusValue);
      if (searchValue) params.set('search', searchValue);
      const payload = await request<{ jobs: AdminJob[]; total: number }>(`/api/admin/jobs?${params.toString()}`);
      setJobs(payload.jobs);
      setTotal(payload.total);
      setOffset(nextOffset);
    } catch (error) {
      setError(error instanceof ApiError ? error.message : '读取任务列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(0, status, query);
  }, [load, status, query]);

  async function openDetail(id: string) {
    setDetailLoading(true);
    setDetail(null);
    try {
      const payload = await request<{ job: Job; email: string | null }>(`/api/admin/jobs/${id}`);
      setDetail(payload);
    } catch (error) {
      setError(error instanceof ApiError ? error.message : '读取任务详情失败');
    } finally {
      setDetailLoading(false);
    }
  }

  async function cancelJob(id: string) {
    setError(null);
    try {
      await request(`/api/admin/jobs/${id}/cancel`, { method: 'POST' });
      await load(offset, status, query);
      if (detail?.job.id === id) await openDetail(id);
    } catch (error) {
      setError(error instanceof ApiError ? error.message : '取消任务失败');
    }
  }

  return (
    <div className="stack-lg">
      <div className="toolbar">
        <select className="input input-inline" value={status} onChange={(event) => setStatus(event.target.value)}>
          {STATUSES.map((value) => (
            <option key={value || 'all'} value={value}>
              {value ? value : '全部状态'}
            </option>
          ))}
        </select>
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
            placeholder="按用户邮箱或任务 ID 搜索"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button type="submit" className="btn btn-secondary">
            搜索
          </button>
        </form>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {loading ? <Loading text="正在读取任务…" /> : null}

      {!loading ? (
        <section className="card">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>任务</th>
                  <th>用户</th>
                  <th>目标</th>
                  <th>文件</th>
                  <th>状态</th>
                  <th>创建时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {jobs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="muted">
                      没有匹配的任务
                    </td>
                  </tr>
                ) : null}
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td className="mono">{job.id.slice(0, 8)}</td>
                    <td className="cell-email">{job.email ?? '—'}</td>
                    <td>{job.target.toUpperCase()}</td>
                    <td>
                      {job.doneFiles + job.failedFiles}/{job.totalFiles}
                    </td>
                    <td>
                      <StatusBadge status={job.status} />
                    </td>
                    <td>{formatDateTime(job.createdAt)}</td>
                    <td className="cell-actions">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void openDetail(job.id)}>
                        详情
                      </button>
                      {job.status === 'queued' || job.status === 'processing' ? (
                        <button type="button" className="btn btn-danger btn-sm" onClick={() => void cancelJob(job.id)}>
                          取消
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination total={total} limit={LIMIT} offset={offset} onChange={(next) => void load(next, status, query)} />
        </section>
      ) : null}

      <Modal
        open={detailLoading || detail !== null}
        title="任务详情"
        onClose={() => setDetail(null)}
        footer={
          detail && (detail.job.status === 'queued' || detail.job.status === 'processing') ? (
            <button type="button" className="btn btn-danger" onClick={() => void cancelJob(detail.job.id)}>
              取消任务
            </button>
          ) : null
        }
      >
        {detailLoading ? <Loading text="正在读取详情…" /> : null}
        {detail ? (
          <div className="stack">
            <dl className="kv">
              <div>
                <dt>任务 ID</dt>
                <dd className="mono">{detail.job.id}</dd>
              </div>
              <div>
                <dt>用户</dt>
                <dd>{detail.email ?? '—'}</dd>
              </div>
              <div>
                <dt>状态</dt>
                <dd>
                  <StatusBadge status={detail.job.status} />
                </dd>
              </div>
              <div>
                <dt>创建 / 结束</dt>
                <dd>
                  {formatDateTime(detail.job.createdAt)} → {formatDateTime(detail.job.finishedAt)}
                </dd>
              </div>
              <div>
                <dt>结果过期</dt>
                <dd>{formatDateTime(detail.job.expiresAt)}（{relativeTime(detail.job.expiresAt)}）</dd>
              </div>
            </dl>
            <ProgressBar value={detail.job.progress} label="任务进度" />
            {detail.job.error ? <Alert tone="error">{detail.job.error}</Alert> : null}
            <ul className="file-list">
              {detail.job.files.map((file) => (
                <li key={file.id} className="file-row">
                  <div className="file-main">
                    <span className="file-name">{file.name}</span>
                    <span className="file-meta">
                      {formatBytes(file.sourceSize)}
                      {file.outputExt ? ` → ${file.outputExt.toUpperCase()} · ${formatBytes(file.outputSize)}` : ''}
                    </span>
                  </div>
                  <div className="file-side">
                    <StatusBadge status={file.status} />
                    {file.error ? <span className="file-error">{file.error}</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
