import type { ReactNode } from 'react';
import { AppFooter } from './AppFooter';
import { AppHeader, type ActivePage } from './AppHeader';

export function Layout({
  active,
  auth = false,
  children,
}: {
  active?: ActivePage;
  auth?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`app-body${auth ? ' app-body--auth' : ''}`}>
      <a className="skip-link" href="#main-content">
        跳转到主要内容
      </a>
      <AppHeader active={active} minimal={auth} />
      <div className="app-header-spacer" aria-hidden="true" />
      {children}
      <AppFooter minimal={auth} />
    </div>
  );
}
