import { useEffect } from 'react';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { isProtectedRoute, safeNext, useRoute } from './router';
import { useSession } from './session';
import AccountPage from './pages/AccountPage';
import AdminPage from './pages/AdminPage';
import FormatsPage from './pages/FormatsPage';
import HistoryPage from './pages/HistoryPage';
import LoginPage from './pages/LoginPage';
import WorkspacePage from './pages/WorkspacePage';

export default function App() {
  const { ready, user } = useSession();
  const { path, query, go } = useRoute();
  const next = safeNext(query.get('next'));

  useEffect(() => {
    if (!ready) return;

    // /convert 是登录回跳用的旧地址，工作台就挂在首页。
    if (path === '/convert') {
      go('/', undefined);
      return;
    }
    if (user && path === '/login') {
      go(next ?? '/');
      return;
    }
    if (!user && isProtectedRoute(path)) {
      go('/login', { next: path });
      return;
    }
    if (user && path === '/admin' && user.role !== 'admin') go('/');
  }, [ready, user, path, next, go]);

  if (!ready) {
    return (
      <div className="boot-screen">
        <Loading text="正在加载大肥鱼格式工坊…" />
      </div>
    );
  }

  if (path === '/login') {
    if (user) {
      return (
        <div className="boot-screen">
          <Loading text="正在返回转换台…" />
        </div>
      );
    }
    return (
      <Layout auth>
        <LoginPage
          next={next}
          mode={query.get('mode') === 'register' ? 'register' : 'login'}
        />
      </Layout>
    );
  }

  if (path === '/formats') {
    return (
      <Layout active="formats">
        <FormatsPage />
      </Layout>
    );
  }

  if (isProtectedRoute(path) && !user) {
    return (
      <div className="boot-screen">
        <Loading text="正在前往登录…" />
      </div>
    );
  }

  if (path === '/history') {
    return (
      <Layout active="history">
        <HistoryPage />
      </Layout>
    );
  }

  if (path === '/account') {
    return (
      <Layout active="account">
        <AccountPage />
      </Layout>
    );
  }

  if (path === '/admin') {
    return user?.role === 'admin' ? (
      <Layout active="admin">
        <AdminPage />
      </Layout>
    ) : (
      <div className="boot-screen">
        <Loading text="正在返回转换台…" />
      </div>
    );
  }

  return (
    <Layout active="convert">
      <WorkspacePage />
    </Layout>
  );
}
