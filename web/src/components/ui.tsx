import { useEffect, useRef, type ReactNode } from 'react';
import type { FileStatus, JobStatus } from '../types';
import { formatPercent } from '../utils';

type AnyStatus = JobStatus | FileStatus;

const STATUS_TEXT: Record<AnyStatus, string> = {
  queued: '排队中',
  pending: '等待中',
  processing: '转换中',
  success: '已完成',
  partial: '部分完成',
  failed: '失败',
  cancelled: '已取消',
};

const STATUS_TONE: Record<AnyStatus, string> = {
  queued: 'queued',
  pending: 'queued',
  processing: 'running',
  success: 'ok',
  partial: 'warn',
  failed: 'bad',
  cancelled: 'muted',
};

export function StatusBadge({ status }: { status: AnyStatus }) {
  return <span className={`badge badge-${STATUS_TONE[status]}`}>{STATUS_TEXT[status] ?? status}</span>;
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="progress-row">
      <progress className="progress" value={clamped} max={100} aria-label={label ?? '进度'} />
      <span className="progress-value">{formatPercent(clamped)}</span>
    </div>
  );
}

type AlertProps = { tone?: 'info' | 'success' | 'error' | 'warn'; title?: string; children: ReactNode };

export function Alert({ tone = 'info', title, children }: AlertProps) {
  return (
    <div className={`alert alert-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {title ? <strong className="alert-title">{title}</strong> : null}
      <div className="alert-body">{children}</div>
    </div>
  );
}

export function Loading({ text = '正在加载…' }: { text?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children ? <p className="empty-hint">{children}</p> : null}
    </div>
  );
}

export function Pagination({
  total,
  limit,
  offset,
  onChange,
}: {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
}) {
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return null;
  return (
    <div className="pagination">
      <button type="button" className="btn btn-ghost" disabled={page <= 1} onClick={() => onChange(Math.max(0, offset - limit))}>
        上一页
      </button>
      <span className="pagination-info">
        第 {page} / {pages} 页 · 共 {total} 条
      </span>
      <button
        type="button"
        className="btn btn-ghost"
        disabled={page >= pages}
        onClick={() => onChange(Math.min((pages - 1) * limit, offset + limit))}
      >
        下一页
      </button>
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === ref.current) onClose();
    }} ref={ref}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="btn btn-icon" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-foot">{footer}</footer> : null}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && !error ? <p className="field-hint">{hint}</p> : null}
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}
