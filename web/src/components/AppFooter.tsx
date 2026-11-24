export function AppFooter({ minimal = false }: { minimal?: boolean }) {
  return (
    <footer className="app-footer">
      <div className="app-container app-footer-inner">
        <span>
          非官方同人界面 ·{' '}
          <a href="/characters/ATTRIBUTION.md" target="_blank" rel="noopener noreferrer">
            角色与素材说明
          </a>
        </span>
        {minimal ? null : (
          <span className="app-footer-version">文件 2 小时后自动清理 · 单文件上限 100 MB</span>
        )}
      </div>
    </footer>
  );
}
