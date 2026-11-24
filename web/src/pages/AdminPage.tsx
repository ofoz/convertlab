import { useState } from 'react';
import Audit from './admin/Audit';
import Jobs from './admin/Jobs';
import Overview from './admin/Overview';
import Settings from './admin/Settings';
import Users from './admin/Users';

const TABS = [
  { id: 'overview', label: '概览' },
  { id: 'users', label: '用户' },
  { id: 'jobs', label: '任务' },
  { id: 'audit', label: '审计日志' },
  { id: 'settings', label: '设置' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function AdminPage() {
  const [tab, setTab] = useState<TabId>('overview');

  return (
    <main id="main-content" className="app-container sx-admin-page page" tabIndex={-1}>
      <header className="page-head">
        <div>
          <h1>管理后台</h1>
          <p className="page-sub">用户、任务、审计与系统设置。</p>
        </div>
      </header>

      <div className="tabs" role="tablist" aria-label="管理后台分区">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? 'tab tab-active' : 'tab'}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'overview' ? <Overview /> : null}
      {tab === 'users' ? <Users /> : null}
      {tab === 'jobs' ? <Jobs /> : null}
      {tab === 'audit' ? <Audit /> : null}
      {tab === 'settings' ? <Settings /> : null}
    </main>
  );
}
