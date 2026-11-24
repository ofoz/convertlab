import { useCallback, useEffect, useState } from 'react';
import { ApiError, request } from '../../api';
import { Alert, Loading } from '../../components/ui';
import type { AdminStats } from '../../types';
import { formatBytes } from '../../utils';

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat-card">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      {hint ? <p className="stat-hint">{hint}</p> : null}
    </div>
  );
}

export default function Overview() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStats(await request<AdminStats>('/api/admin/stats'));
    } catch (error) {
      setError(error instanceof ApiError ? error.message : '读取统计失败');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!stats) return <Loading text="正在读取统计…" />;

  const jobs = stats.jobs;

  return (
    <div className="stack-lg">
      <div className="stat-grid">
        <StatCard label="用户总数" value={String(stats.users.total)} hint={`活跃管理员 ${stats.users.activeAdmins}`} />
        <StatCard label="今日任务" value={String(stats.usage.jobsToday)} hint={`待处理 ${stats.pending}`} />
        <StatCard label="今日上传" value={formatBytes(stats.usage.uploadBytesToday)} />
        <StatCard label="今日输出" value={formatBytes(stats.usage.outputBytesToday)} />
        <StatCard
          label="活跃结果文件"
          value={formatBytes(stats.storage.activeOutputBytes)}
          hint={`${stats.storage.activeOutputFiles} 个文件`}
        />
        <StatCard label="数据库大小" value={formatBytes(stats.storage.databaseBytes)} />
      </div>

      <section className="card">
        <h2>任务状态分布</h2>
        <ul className="chip-list">
          <li className="chip">总计 {jobs.total ?? 0}</li>
          <li className="chip">排队 {jobs.queued ?? 0}</li>
          <li className="chip">处理中 {jobs.processing ?? 0}</li>
          <li className="chip">成功 {jobs.success ?? 0}</li>
          <li className="chip">部分成功 {jobs.partial ?? 0}</li>
          <li className="chip">失败 {jobs.failed ?? 0}</li>
          <li className="chip">已取消 {jobs.cancelled ?? 0}</li>
        </ul>
      </section>

      <section className="card">
        <h2>当前限制</h2>
        <dl className="kv kv-grid">
          <div>
            <dt>单文件上限</dt>
            <dd>{formatBytes(stats.limits.maxFileBytes)}</dd>
          </div>
          <div>
            <dt>每批文件数</dt>
            <dd>{stats.limits.maxBatchFiles}</dd>
          </div>
          <div>
            <dt>每日任务</dt>
            <dd>{stats.limits.dailyJobs}</dd>
          </div>
          <div>
            <dt>每日上传</dt>
            <dd>{formatBytes(stats.limits.dailyUploadBytes)}</dd>
          </div>
          <div>
            <dt>每日输出</dt>
            <dd>{formatBytes(stats.limits.dailyOutputBytes)}</dd>
          </div>
          <div>
            <dt>结果保留</dt>
            <dd>{stats.limits.fileTtlHours} 小时</dd>
          </div>
          <div>
            <dt>Worker 并发</dt>
            <dd>{stats.limits.workerConcurrency}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
