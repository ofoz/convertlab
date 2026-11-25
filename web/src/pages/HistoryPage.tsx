import { useCallback, useEffect, useState } from 'react';
import { ApiError, downloadUrl, request, zipUrl } from '../api';
import { SymbolIcon } from '../components/Symbols';
import type { Job, JobStatus } from '../types';
import { formatDateTime } from '../utils';

const LIMIT = 10;

function jobStatus(status: JobStatus): { text: string; tone: string } {
  if (status === 'success') return { text: '已完成', tone: 'sx-badge-success' };
  if (status === 'partial') return { text: '部分完成', tone: 'sx-badge-warning' };
  if (status === 'failed') return { text: '转换失败', tone: 'sx-badge-warning' };
  if (status === 'cancelled') return { text: '已取消', tone: 'sx-badge-pending' };
  return { text: '处理中', tone: 'sx-badge-pending' };
}

function fileStatus(status: string): { text: string; tone: string } {
  if (status === 'success') return { text: '成功', tone: 'sx-badge-success' };
  if (status === 'failed') return { text: '转换失败', tone: 'sx-badge-warning' };
  if (status === 'cancelled') return { text: '已取消', tone: 'sx-badge-warning' };
  if (status === 'pending') return { text: '排队中', tone: 'sx-badge-pending' };
  return { text: '处理中', tone: 'sx-badge-pending' };
}

function outputName(name: string, ext: string | null): string {
  if (!ext) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${stem}.${ext}`;
}

export default function HistoryPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (nextOffset: number) => {
    setLoading(true);
    setError(null);
    try {
      const payload = await request<{ jobs: Job[]; total: number }>(
        `/api/jobs?limit=${LIMIT}&offset=${nextOffset}`,
      );
      setJobs(payload.jobs);
      setTotal(payload.total);
      setOffset(nextOffset);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '读取历史记录失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(0);
  }, [load]);

  const cancel = useCallback(
    async (job: Job) => {
      if (!window.confirm('确定取消这个转换任务吗？')) return;
      try {
        await request<{ job: Job | null }>(`/api/jobs/${encodeURIComponent(job.id)}`, { method: 'DELETE' });
        setNotice('已取消该任务。');
        await load(offset);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : '取消失败，请稍后重试');
      }
    },
    [load, offset],
  );

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const currentPage = Math.floor(offset / LIMIT) + 1;
  const pageNumbers = [...new Set([1, currentPage - 1, currentPage, currentPage + 1, totalPages])]
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((left, right) => left - right);

  return (
    <main id="main-content" className="app-container sx-page" tabIndex={-1}>
      <div className="page-heading sx-page-heading">
        <span className="eyebrow">任务中心</span>
        <h1>转换历史</h1>
        <p className="muted">查看任务进度、文件结果，或取消排队中的任务。</p>
      </div>

      {notice ? (
        <p className="cx-notice" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="cx-notice cx-notice-error" role="alert">
          {error}
        </p>
      ) : null}

      {loading && jobs.length === 0 ? (
        <section className="surface empty-state sx-empty-history">
          <p className="muted">正在读取任务…</p>
        </section>
      ) : null}

      {!loading && jobs.length === 0 && !error ? (
        <section className="surface empty-state sx-empty-history">
          <span className="sx-empty-mark">
            <SymbolIcon name="history" size={25} />
          </span>
          <h2>这里还没有转换记录</h2>
          <p className="muted">开始一次转换后，任务和文件都会保存在这里。</p>
          <a href="#/" className="btn-primary">
            前往转换台 <SymbolIcon name="arrow" size={16} />
          </a>
        </section>
      ) : null}

      {jobs.length > 0 ? (
        <section className="surface sx-history-panel" aria-labelledby="sx-history-title">
          <div className="sx-panel-head sx-history-head">
            <div>
              <h2 id="sx-history-title">任务列表</h2>
              <p className="muted">结果文件保留 12 小时，过期后自动清理。</p>
            </div>
            <div className="sx-selection-actions">
              <button
                type="button"
                className="sx-text-action"
                onClick={() => void load(offset)}
                disabled={loading}
              >
                刷新
              </button>
            </div>
          </div>
          <div className="sx-table-wrap">
            <table className="sx-table sx-history-table">
              <thead>
                <tr>
                  <th scope="col">文件</th>
                  <th scope="col">目标格式</th>
                  <th scope="col">创建时间</th>
                  <th scope="col">状态</th>
                  <th scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => {
                  const first = job.files[0];
                  const status = jobStatus(job.status);
                  const successes = job.files.filter((file) => file.status === 'success');
                  const finished = job.status === 'success' || job.status === 'partial' || job.status === 'failed' || job.status === 'cancelled';
                  const downloadHref =
                    successes.length === 1 && successes[0]
                      ? downloadUrl(job.id, successes[0].id)
                      : successes.length > 1
                        ? zipUrl(job.id)
                        : null;
                  return (
                    <tr key={job.id} id={`job-row-${job.id}`}>
                      <td>
                        <details className="sx-history-details">
                          <summary>
                            <span className="sx-file-icon">
                              <SymbolIcon name="file" size={17} />
                            </span>
                            <span className="sx-history-file-name" title={first?.name}>
                              {first?.name ?? '文件信息处理中'}
                            </span>
                            <span className="badge sx-file-count">{job.totalFiles} 个文件</span>
                            <span className="sx-details-label">
                              文件清单 <SymbolIcon name="chevron" size={14} />
                            </span>
                          </summary>
                          <div className="sx-detail-list">
                            {job.files.map((file) => {
                              const fs = fileStatus(file.status);
                              return (
                                <div className="sx-detail-row" key={file.id}>
                                  <span className="sx-detail-name" title={file.name}>
                                    {file.name}
                                  </span>
                                  <SymbolIcon name="arrow" size={15} />
                                  <span className="sx-detail-name" title={file.outputExt ?? undefined}>
                                    {file.status === 'success'
                                      ? outputName(file.name, file.outputExt)
                                      : file.error ?? '未生成结果'}
                                  </span>
                                  <span className={`badge ${fs.tone}`} title={fs.text}>
                                    {fs.text}
                                  </span>
                                  {file.status === 'success' ? (
                                    <a
                                      className="sx-text-action"
                                      href={downloadUrl(job.id, file.id)}
                                      download
                                    >
                                      下载
                                    </a>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        </details>
                      </td>
                      <td className="sx-target-cell">
                        <span className="sx-target-format" title={`目标格式：${job.target.toUpperCase()}`}>
                          {job.target.toUpperCase()}
                        </span>
                      </td>
                      <td className="sx-date-cell">
                        <time dateTime={new Date(job.createdAt).toISOString()}>
                          {formatDateTime(job.createdAt)}
                        </time>
                      </td>
                      <td>
                        <span className={`badge ${status.tone}`} title={status.text}>
                          <span className="sx-status-dot" />
                          {status.text}
                        </span>
                      </td>
                      <td>
                        <div className="sx-actions sx-history-actions">
                          {downloadHref ? (
                            <a
                              className="sx-text-action"
                              href={downloadHref}
                              download
                              aria-label={`下载任务 ${job.id} 的结果`}
                            >
                              <SymbolIcon name="arrow" size={16} /> 下载
                            </a>
                          ) : (
                            <span className="sx-text-action is-disabled" aria-disabled="true">
                              <SymbolIcon name="arrow" size={16} /> 下载
                            </span>
                          )}
                          {!finished ? (
                            <button
                              type="button"
                              className="sx-icon-danger"
                              aria-label={`取消任务 ${job.id}`}
                              title="取消任务"
                              onClick={() => void cancel(job)}
                            >
                              <SymbolIcon name="x" size={17} />
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {total > 0 ? (
        <nav className="sx-history-pagination" aria-label="转换历史分页">
          <span className="sx-history-page-summary">
            第 {currentPage} / {totalPages} 页，共 {total} 个任务
          </span>
          <div className="sx-history-page-links">
            {currentPage > 1 ? (
              <button
                type="button"
                className="sx-text-action"
                onClick={() => void load((currentPage - 2) * LIMIT)}
              >
                <SymbolIcon name="arrow" size={15} /> 上一页
              </button>
            ) : (
              <span className="sx-text-action is-disabled" aria-disabled="true">
                上一页
              </span>
            )}
            {pageNumbers.map((page, index) => (
              <span key={page} style={{ display: 'contents' }}>
                {index > 0 && page - (pageNumbers[index - 1] ?? page) > 1 ? (
                  <span className="sx-history-page is-ellipsis" aria-hidden="true">
                    …
                  </span>
                ) : null}
                {page === currentPage ? (
                  <span className="sx-history-page is-current" aria-current="page">
                    {page}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="sx-history-page"
                    onClick={() => void load((page - 1) * LIMIT)}
                  >
                    {page}
                  </button>
                )}
              </span>
            ))}
            {currentPage < totalPages ? (
              <button
                type="button"
                className="sx-text-action"
                onClick={() => void load(currentPage * LIMIT)}
              >
                下一页 <SymbolIcon name="arrow" size={15} />
              </button>
            ) : (
              <span className="sx-text-action is-disabled" aria-disabled="true">
                下一页
              </span>
            )}
          </div>
        </nav>
      ) : null}
    </main>
  );
}
