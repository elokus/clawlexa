// ═══════════════════════════════════════════════════════════════════════════
// Settings Sidebar - Navigation between settings pages
// ═══════════════════════════════════════════════════════════════════════════

import { useConfigStore } from '../../stores/config-store';
import { navigate, type SettingsPage } from '../../hooks/useRouter';

const PAGES: Array<{ id: SettingsPage; label: string; icon: string; description: string }> = [
  { id: 'agents', label: 'Agents', icon: 'M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z', description: 'Profiles, prompts, tools' },
  { id: 'voice-pipeline', label: 'Voice Pipeline', icon: 'M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z', description: 'Mode, providers, models' },
  { id: 'audio', label: 'Audio & VAD', icon: 'M9.348 14.652a3.75 3.75 0 0 1 0-5.304m5.304 0a3.75 3.75 0 0 1 0 5.304m-7.425 2.121a6.75 6.75 0 0 1 0-9.546m9.546 0a6.75 6.75 0 0 1 0 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z', description: 'Turn detection, VAD' },
  { id: 'credentials', label: 'Credentials', icon: 'M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z', description: 'API keys, auth profiles' },
  { id: 'system', label: 'System', icon: 'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z', description: 'Advanced, debug' },
];

export function SettingsSidebar() {
  const activePage = useConfigStore((s) => s.activePage);
  const setActivePage = useConfigStore((s) => s.setActivePage);

  const handlePageClick = (page: SettingsPage) => {
    setActivePage(page);
    navigate(`/settings/${page}`, true);
  };

  return (
    <div className="settings-sidebar">
      <style>{`
        .settings-sidebar {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: rgba(3, 3, 8, 0.6);
          border-right: 1px solid var(--color-glass-border);
          overflow-y: auto;
        }

        .settings-sidebar-back {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 14px 16px;
          border-bottom: 1px solid var(--color-glass-border);
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--color-text-dim);
          cursor: pointer;
          transition: color 0.15s ease;
          background: none;
          border-left: none;
          border-right: none;
          border-top: none;
          width: 100%;
          text-align: left;
        }

        .settings-sidebar-back:hover {
          color: var(--color-cyan);
        }

        .settings-sidebar-back svg {
          width: 14px;
          height: 14px;
          flex-shrink: 0;
        }

        .settings-sidebar-title {
          padding: 16px 16px 8px;
          font-family: var(--font-display);
          font-size: 10px;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          color: var(--color-text-ghost);
        }

        .settings-sidebar-nav {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 4px 8px;
          flex: 1;
        }

        .settings-nav-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.15s ease;
          border: 1px solid transparent;
          background: none;
          width: 100%;
          text-align: left;
        }

        .settings-nav-item:hover {
          background: rgba(56, 189, 248, 0.04);
          border-color: rgba(56, 189, 248, 0.08);
        }

        .settings-nav-item.active {
          background: rgba(56, 189, 248, 0.08);
          border-color: rgba(56, 189, 248, 0.15);
        }

        .settings-nav-icon {
          width: 18px;
          height: 18px;
          flex-shrink: 0;
          color: var(--color-text-ghost);
          transition: color 0.15s ease;
        }

        .settings-nav-item.active .settings-nav-icon,
        .settings-nav-item:hover .settings-nav-icon {
          color: var(--color-cyan);
        }

        .settings-nav-text {
          display: flex;
          flex-direction: column;
          gap: 1px;
          min-width: 0;
        }

        .settings-nav-label {
          font-family: var(--font-ui);
          font-size: 13px;
          font-weight: 500;
          color: var(--color-text-dim);
          transition: color 0.15s ease;
        }

        .settings-nav-item.active .settings-nav-label {
          color: var(--color-text-bright);
        }

        .settings-nav-desc {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-ghost);
        }

        @media (max-width: 900px) {
          .settings-nav-desc {
            display: none;
          }
        }
      `}</style>

      <button
        type="button"
        className="settings-sidebar-back"
        onClick={() => navigate('/')}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
        </svg>
        Dashboard
      </button>

      <div className="settings-sidebar-title">Configuration</div>

      <nav className="settings-sidebar-nav">
        {PAGES.map((page) => (
          <button
            key={page.id}
            type="button"
            className={`settings-nav-item ${activePage === page.id ? 'active' : ''}`}
            onClick={() => handlePageClick(page.id)}
          >
            <svg className="settings-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d={page.icon} />
            </svg>
            <div className="settings-nav-text">
              <span className="settings-nav-label">{page.label}</span>
              <span className="settings-nav-desc">{page.description}</span>
            </div>
          </button>
        ))}
      </nav>
    </div>
  );
}
