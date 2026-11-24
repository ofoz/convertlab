import { useCallback, useEffect, useState } from 'react';
import { ApiError, request } from '../../api';
import { Alert, Loading, Pagination } from '../../components/ui';
import type { AuditRow } from '../../types';
import { formatDateTime } from '../../utils';

const LIMIT = 25;

function detailText(detail: unknown): string {
  if (detail === null || detail === undefined) return '';
  if (typeof detail === 'string') return detail;
  try {
    return JSON.stringify(detail);
  } catch {
    return '';
  }
}

export default function Audit() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [action, setAction] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextOffset: number, actionValue: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(LIMIT), offset: String(nextOffset) });
      if (actionValue) params.set('action', actionValue);
      const payload = await request<{ rows: AuditRow[]; total: number }>(`/api/admin/audit?${params.toString()}`);
      setRows(payload.rows);
      setTotal(payload.total);
      setOffset(nextOffset);
    } catch (error) {
      setError(error instanceof ApiError ? error.message : '读取审计日志失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(0, query);
  }, [load, query]);

  return (
    <div className="stack-lg">
      <div className="toolbar">
        <form
          className="search"
          onSubmit={(event) => {
            event.preventDefault();
            setQuery(action.trim());
          }}
        >
          <input
            className="input"
            type="search"
            placeholder="按动作筛选，例如 login"
            value={action}
            onChange={(event) => setAction(event.target.value)}
          />
          <button type="submit" className="btn btn-secondary">
            筛选
          </button>
        </form>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {loading ? <Loading text="正在读取日志…" /> : null}

      {!loading ? (
        <section className="card">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>动作</th>
                  <th>操作者</th>
                  <th>对象</th>
                  <th>IP</th>
                  <th>详情</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      没有匹配的审计记录
                    </td>
                  </tr>
                ) : null}
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDateTime(row.created_at)}</td>
                    <td className="mono">{row.action}</td>
                    <td className="mono">{row.actor_id ? row.actor_id.slice(0, 8) : '系统'}</td>
                    <td className="mono">
                      {row.target_type ?? '—'}
                      {row.target_id ? `:${row.target_id.slice(0, 8)}` : ''}
                    </td>
                    <td className="mono">{row.ip ?? '—'}</td>
                    <td className="cell-detail" title={detailText(row.detail)}>
                      {detailText(row.detail)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination total={total} limit={LIMIT} offset={offset} onChange={(next) => void load(next, query)} />
        </section>
      ) : null}
    </div>
  );
}
