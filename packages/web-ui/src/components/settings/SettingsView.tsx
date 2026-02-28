// ═══════════════════════════════════════════════════════════════════════════
// Settings View - macOS System Settings inspired layout
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect } from 'react';
import { useConfigStore } from '../../stores/config-store';
import { SettingsSidebar } from './SettingsSidebar';
import { SaveBar } from './SaveBar';
import { SettingsAgents } from './SettingsAgents';
import { SettingsVoicePipeline } from './SettingsVoicePipeline';
import { SettingsAudio } from './SettingsAudio';
import { SettingsCredentials } from './SettingsCredentials';
import { SettingsSystem } from './SettingsSystem';
import { SettingsModels } from './SettingsModels';
import type { SettingsPage } from '../../hooks/useRouter';

const PAGE_META: Record<SettingsPage, { title: string; description: string }> = {
  agents: {
    title: 'Agents',
    description: 'Voice profiles, prompts, wake words, and tool configuration.',
  },
  'voice-pipeline': {
    title: 'Voice Pipeline',
    description: 'Runtime mode, provider selection, and model configuration.',
  },
  audio: {
    title: 'Audio & VAD',
    description: 'Turn detection, voice activity, and audio input settings.',
  },
  credentials: {
    title: 'Credentials',
    description: 'API keys and auth profiles for voice providers.',
  },
  models: {
    title: 'Model Control',
    description: 'Local STT/TTS model management and benchmarking.',
  },
  system: {
    title: 'System',
    description: 'Advanced settings and debug information.',
  },
};

function PageContent({ page }: { page: SettingsPage }) {
  switch (page) {
    case 'agents':
      return <SettingsAgents />;
    case 'voice-pipeline':
      return <SettingsVoicePipeline />;
    case 'audio':
      return <SettingsAudio />;
    case 'credentials':
      return <SettingsCredentials />;
    case 'models':
      return <SettingsModels />;
    case 'system':
      return <SettingsSystem />;
  }
}

interface SettingsViewProps {
  initialPage?: SettingsPage;
}

export function SettingsView({ initialPage }: SettingsViewProps) {
  const activePage = useConfigStore((s) => s.activePage);
  const setActivePage = useConfigStore((s) => s.setActivePage);
  const loadAll = useConfigStore((s) => s.loadAll);
  const configLoading = useConfigStore((s) => s.configLoading);

  useEffect(() => {
    if (initialPage && initialPage !== activePage) {
      setActivePage(initialPage);
    }
  }, [initialPage]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void loadAll();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const meta = PAGE_META[activePage];

  return (
    <div className="settings-view">
      <style>{`
        .settings-view {
          display: grid;
          grid-template-columns: 220px 1fr;
          height: 100%;
          overflow: hidden;
          background: var(--background);
        }

        .settings-main {
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow: hidden;
          background: var(--background);
        }

        .settings-header {
          padding: 28px 36px 20px;
          flex-shrink: 0;
        }

        .settings-header-title {
          font-family: var(--font-sans);
          font-size: 22px;
          font-weight: 700;
          letter-spacing: -0.02em;
          color: var(--foreground);
          margin: 0 0 4px;
        }

        .settings-header-desc {
          font-family: var(--font-sans);
          font-size: 13px;
          color: var(--muted-foreground);
          margin: 0;
          line-height: 1.5;
        }

        .settings-content {
          flex: 1;
          overflow-y: auto;
          padding: 0 36px 40px;
        }

        .settings-content::-webkit-scrollbar {
          width: 6px;
        }

        .settings-content::-webkit-scrollbar-track {
          background: transparent;
        }

        .settings-content::-webkit-scrollbar-thumb {
          background: var(--border);
          border-radius: 3px;
        }

        .settings-content::-webkit-scrollbar-thumb:hover {
          background: var(--muted-foreground);
        }

        .settings-loading {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 200px;
          font-family: var(--font-sans);
          font-size: 13px;
          color: var(--muted-foreground);
        }

        /* ─── Settings Section Card ─── */

        .settings-section {
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 20px 22px;
          margin-bottom: 14px;
        }

        .settings-section-header {
          margin-bottom: 16px;
        }

        .settings-section-title {
          font-family: var(--font-sans);
          font-size: 13px;
          font-weight: 600;
          color: var(--foreground);
          margin: 0 0 3px;
        }

        .settings-section-desc {
          font-family: var(--font-sans);
          font-size: 12px;
          color: var(--muted-foreground);
          margin: 0;
          line-height: 1.5;
        }

        .settings-section-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
          gap: 14px;
        }

        .settings-section-grid.cols-1 {
          grid-template-columns: 1fr;
        }

        .settings-section-grid.cols-2 {
          grid-template-columns: repeat(2, 1fr);
        }

        .settings-section-grid.cols-3 {
          grid-template-columns: repeat(3, 1fr);
        }

        @media (max-width: 900px) {
          .settings-section-grid.cols-3 {
            grid-template-columns: repeat(2, 1fr);
          }
        }

        @media (max-width: 600px) {
          .settings-section-grid.cols-2,
          .settings-section-grid.cols-3 {
            grid-template-columns: 1fr;
          }
        }

        /* ─── Field Styling ─── */

        .settings-field {
          display: flex;
          flex-direction: column;
          gap: 5px;
          min-width: 0;
        }

        .settings-field.full-width {
          grid-column: 1 / -1;
        }

        .settings-field-label {
          font-family: var(--font-sans);
          font-size: 12px;
          font-weight: 500;
          color: var(--foreground);
        }

        .settings-field-hint {
          font-family: var(--font-sans);
          font-size: 11px;
          color: var(--muted-foreground);
          line-height: 1.4;
        }

        .settings-field select,
        .settings-field input[type="text"],
        .settings-field input[type="number"],
        .settings-field input[type="password"],
        .settings-field input[type="range"],
        .settings-field textarea {
          width: 100%;
          padding: 8px 10px;
          background: var(--input);
          border: 1px solid var(--border);
          border-radius: 6px;
          color: var(--foreground);
          font-family: var(--font-sans);
          font-size: 13px;
          outline: none;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
          box-sizing: border-box;
        }

        .settings-field select:focus,
        .settings-field input:focus,
        .settings-field textarea:focus {
          border-color: var(--color-blue);
          box-shadow: 0 0 0 2px color-mix(in oklch, var(--color-blue) 20%, transparent);
        }

        .settings-field select {
          cursor: pointer;
          -webkit-appearance: none;
          appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%23999' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 8px center;
          padding-right: 28px;
        }

        .settings-field textarea {
          min-height: 60px;
          resize: vertical;
          line-height: 1.5;
        }

        /* ─── Advanced Toggle ─── */

        .settings-advanced-toggle {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 0;
          margin: 4px 0;
          background: none;
          border: none;
          cursor: pointer;
          font-family: var(--font-sans);
          font-size: 12px;
          color: var(--muted-foreground);
          transition: color 0.15s ease;
        }

        .settings-advanced-toggle:hover {
          color: var(--foreground);
        }

        .settings-advanced-toggle svg {
          width: 14px;
          height: 14px;
          transition: transform 0.2s ease;
        }

        .settings-advanced-toggle.expanded svg {
          transform: rotate(180deg);
        }

        /* ─── Placeholder ─── */

        .settings-placeholder {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 300px;
          gap: 12px;
          color: var(--muted-foreground);
        }

        @media (max-width: 900px) {
          .settings-view {
            grid-template-columns: 190px 1fr;
          }
          .settings-content {
            padding: 0 20px 24px;
          }
          .settings-header {
            padding: 20px 20px 14px;
          }
        }

        @media (max-width: 700px) {
          .settings-view {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <SettingsSidebar />

      <div className="settings-main">
        <div className="settings-header">
          <h1 className="settings-header-title">{meta.title}</h1>
          <p className="settings-header-desc">{meta.description}</p>
        </div>

        <div className="settings-content">
          {configLoading ? (
            <div className="settings-loading">Loading configuration...</div>
          ) : (
            <PageContent page={activePage} />
          )}
        </div>

        <SaveBar />
      </div>
    </div>
  );
}
