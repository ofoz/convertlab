import { useSession } from '../session';
import { SymbolIcon } from './Symbols';

export type ActivePage = 'convert' | 'formats' | 'history' | 'account' | 'admin';

export function AppHeader({ active, minimal = false }: { active?: ActivePage; minimal?: boolean }) {
  const { user, signOut } = useSession();

  return (
    <header className="app-header">
      <nav className="app-container app-nav" aria-label="主导航">
        <a className="app-brand" href="#/" aria-label="大肥鱼格式工坊，营业中">
          <img
            className="app-brand-image"
            src="/brand-workshop.png"
            alt="大肥鱼格式工坊"
            width="311"
            height="69"
          />
        </a>
        {minimal ? null : (
        <ul className="app-nav-links app-nav-links--workspace" aria-label="工作区">
          <li>
            <a className="app-nav-link" href="#/" aria-current={active === 'convert' ? 'page' : undefined}>
              <SymbolIcon name="layers" size={17} />
              <span>转换台</span>
            </a>
          </li>
          <li>
            <a
              className="app-nav-link"
              href="#/formats"
              aria-current={active === 'formats' ? 'page' : undefined}
            >
              <SymbolIcon name="grid" size={17} />
              <span>支持格式</span>
            </a>
          </li>
          {user ? (
            <li>
              <a
                className="app-nav-link"
                href="#/history"
                aria-current={active === 'history' ? 'page' : undefined}
              >
                <SymbolIcon name="history" size={17} />
                <span>历史记录</span>
              </a>
            </li>
          ) : null}
          {user?.role === 'admin' ? (
            <li>
              <a
                className="app-nav-link"
                href="#/admin"
                aria-current={active === 'admin' ? 'page' : undefined}
              >
                <SymbolIcon name="shield" size={17} />
                <span>管理后台</span>
              </a>
            </li>
          ) : null}
        </ul>
        )}
        <ul className="app-nav-links app-nav-links--account" aria-label="账号操作">
          {user ? (
            <>
              <li>
                <a
                  className="app-nav-link"
                  href="#/account"
                  aria-current={active === 'account' ? 'page' : undefined}
                >
                  <SymbolIcon name="settings" size={17} />
                  <span>账号</span>
                </a>
              </li>
              <li>
                <button
                  type="button"
                  className="app-nav-link"
                  onClick={() => {
                    void signOut();
                  }}
                >
                  <SymbolIcon name="arrow" size={17} />
                  <span>退出</span>
                </button>
              </li>
            </>
          ) : (
            <>
              <li>
                <a className="app-nav-link" href="#/login">
                  <SymbolIcon name="arrow" size={17} />
                  <span>登录</span>
                </a>
              </li>
              <li>
                <a className="app-nav-link app-nav-link--register" href="#/login?mode=register">
                  注册
                </a>
              </li>
            </>
          )}
        </ul>
      </nav>
    </header>
  );
}
