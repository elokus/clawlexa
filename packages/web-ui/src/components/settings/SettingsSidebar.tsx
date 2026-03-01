import { useConfigStore } from '../../stores/config-store';
import { navigate, type SettingsPage } from '../../hooks/useRouter';

const PAGES: Array<{ id: SettingsPage; label: string; icon: string }> = [
  { id: 'agents', label: 'Agents', icon: 'M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z' },
  { id: 'tool-generator', label: 'Tool Generator', icon: 'M14.25 4.5a3.75 3.75 0 0 1 5.303 5.303l-9.28 9.28a4.5 4.5 0 0 1-1.897 1.13l-2.564.855a.75.75 0 0 1-.949-.949l.855-2.564a4.5 4.5 0 0 1 1.13-1.897l9.28-9.28ZM12 6.75 17.25 12' },
  { id: 'voice-pipeline', label: 'Default Pipeline', icon: 'M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z' },
  { id: 'voices', label: 'Voice Library', icon: 'M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z' },
  { id: 'audio', label: 'Audio & VAD', icon: 'M9.348 14.652a3.75 3.75 0 0 1 0-5.304m5.304 0a3.75 3.75 0 0 1 0 5.304m-7.425 2.121a6.75 6.75 0 0 1 0-9.546m9.546 0a6.75 6.75 0 0 1 0 9.546M12 12h.008v.008H12V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z' },
  { id: 'credentials', label: 'Credentials', icon: 'M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z' },
  { id: 'models', label: 'Model Control', icon: 'M21 16.5V8.25a2.25 2.25 0 0 0-1.172-1.98l-7.5-4.5a2.25 2.25 0 0 0-2.328 0l-7.5 4.5A2.25 2.25 0 0 0 1.5 8.25v8.25a2.25 2.25 0 0 0 1.172 1.98l7.5 4.5a2.25 2.25 0 0 0 2.328 0l7.5-4.5A2.25 2.25 0 0 0 21 16.5Z M12 9.75v10.5m5.25-7.5L12 9.75 6.75 12.75' },
  { id: 'system', label: 'System', icon: 'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z' },
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
          background: var(--sidebar);
          border-right: 1px solid var(--sidebar-border);
          overflow-y: auto;
        }

        .settings-sidebar-back {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 12px 14px;
          font-family: var(--font-sans);
          font-size: 13px;
          font-weight: 500;
          color: var(--muted-foreground);
          cursor: pointer;
          transition: color 0.15s ease;
          background: none;
          border: none;
          border-bottom: 1px solid var(--sidebar-border);
          width: 100%;
          text-align: left;
          min-height: auto;
        }

        .settings-sidebar-back:hover {
          color: var(--foreground);
        }

        .settings-sidebar-back svg {
          width: 14px;
          height: 14px;
          flex-shrink: 0;
        }

        .settings-sidebar-nav {
          display: flex;
          flex-direction: column;
          gap: 1px;
          padding: 8px 6px;
          flex: 1;
        }

        .settings-nav-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 10px;
          border-radius: 8px;
          cursor: pointer;
          transition: background 0.12s ease;
          border: none;
          background: none;
          width: 100%;
          text-align: left;
          min-height: auto;
        }

        .settings-nav-item:hover {
          background: var(--sidebar-accent);
        }

        .settings-nav-item.active {
          background: var(--sidebar-accent);
        }

        .settings-nav-icon {
          width: 16px;
          height: 16px;
          color: var(--muted-foreground);
          flex-shrink: 0;
          transition: color 0.12s ease;
        }

        .settings-nav-item.active .settings-nav-icon {
          color: var(--foreground);
        }

        .settings-nav-label {
          font-family: var(--font-sans);
          font-size: 13px;
          font-weight: 400;
          color: var(--foreground);
        }

        .settings-nav-item.active .settings-nav-label {
          font-weight: 500;
        }

        @media (max-width: 900px) {
          .settings-nav-label {
            font-size: 12px;
          }
        }
      `}</style>

      <button
        type="button"
        className="settings-sidebar-back"
        onClick={() => navigate('/')}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Back
      </button>

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
            <span className="settings-nav-label">{page.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
