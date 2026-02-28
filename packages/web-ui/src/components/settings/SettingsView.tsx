// ═══════════════════════════════════════════════════════════════════════════
// Settings View - Main settings layout with sidebar + content area
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
import type { SettingsPage } from '../../hooks/useRouter';

const SIDEBAR_WIDTH = 240;

const PAGE_META: Record<SettingsPage, { title: string; description: string }> = {
  agents: {
    title: 'Agents',
    description: 'Configure voice agent profiles, prompts, tools, and wake words.',
  },
  'voice-pipeline': {
    title: 'Voice Pipeline',
    description: 'Select voice mode, providers, models, and pipeline configuration.',
  },
  audio: {
    title: 'Audio & VAD',
    description: 'Turn detection strategy, voice activity detection, and audio settings.',
  },
  credentials: {
    title: 'Credentials',
    description: 'Manage API keys and authentication profiles for voice providers.',
  },
  system: {
    title: 'System',
    description: 'Advanced settings, word timestamps, and debug information.',
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

  // Sync initial page from URL
  useEffect(() => {
    if (initialPage && initialPage !== activePage) {
      setActivePage(initialPage);
    }
  }, [initialPage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load all config data on mount
  useEffect(() => {
    void loadAll();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const meta = PAGE_META[activePage];

  return (
    <div className="settings-view">
      <style>{`
        .settings-view {
          display: grid;
          grid-template-columns: ${SIDEBAR_WIDTH}px 1fr;
          height: 100%;
          overflow: hidden;
          background: var(--color-abyss);
        }

        .settings-main {
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow: hidden;
        }

        .settings-header {
          padding: 24px 32px 16px;
          border-bottom: 1px solid var(--color-glass-border);
          flex-shrink: 0;
        }

        .settings-header-title {
          font-family: var(--font-display);
          font-size: 18px;
          font-weight: 600;
          letter-spacing: 0.08em;
          color: var(--color-text-bright);
          margin: 0 0 6px;
        }

        .settings-header-desc {
          font-family: var(--font-ui);
          font-size: 13px;
          color: var(--color-text-normal);
          margin: 0;
          line-height: 1.5;
        }

        .settings-content {
          flex: 1;
          overflow-y: auto;
          padding: 24px 32px 32px;
        }

        .settings-content::-webkit-scrollbar {
          width: 6px;
        }

        .settings-content::-webkit-scrollbar-track {
          background: transparent;
        }

        .settings-content::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.08);
          border-radius: 3px;
        }

        .settings-content::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.15);
        }

        .settings-loading {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 200px;
          font-family: var(--font-mono);
          font-size: 12px;
          color: var(--color-text-dim);
        }

        /* ─── Shared settings section card ─── */

        .settings-section {
          background: rgba(10, 10, 18, 0.5);
          border: 1px solid var(--color-glass-border);
          border-radius: 12px;
          padding: 20px 24px;
          margin-bottom: 16px;
        }

        .settings-section-header {
          margin-bottom: 16px;
        }

        .settings-section-title {
          font-family: var(--font-display);
          font-size: 13px;
          font-weight: 500;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--color-text-bright);
          margin: 0 0 4px;
        }

        .settings-section-desc {
          font-family: var(--font-ui);
          font-size: 12px;
          color: var(--color-text-dim);
          margin: 0;
          line-height: 1.5;
        }

        .settings-section-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
          gap: 16px;
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

        /* ─── Shared field styling ─── */

        .settings-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-width: 0;
        }

        .settings-field.full-width {
          grid-column: 1 / -1;
        }

        .settings-field-label {
          font-family: var(--font-mono);
          font-size: 12px;
          font-weight: 500;
          color: var(--color-text-normal);
          letter-spacing: 0.02em;
        }

        .settings-field-hint {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--color-text-dim);
          line-height: 1.4;
        }

        .settings-field select,
        .settings-field input[type="text"],
        .settings-field input[type="number"],
        .settings-field input[type="password"],
        .settings-field input[type="range"],
        .settings-field textarea {
          width: 100%;
          padding: 9px 12px;
          background: rgba(5, 5, 12, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 6px;
          color: var(--color-text-bright);
          font-family: var(--font-mono);
          font-size: 13px;
          outline: none;
          transition: border-color 0.15s ease;
          box-sizing: border-box;
        }

        .settings-field select:focus,
        .settings-field input:focus,
        .settings-field textarea:focus {
          border-color: rgba(56, 189, 248, 0.3);
        }

        .settings-field select {
          cursor: pointer;
        }

        .settings-field textarea {
          min-height: 60px;
          resize: vertical;
          line-height: 1.5;
        }

        /* ─── Advanced toggle ─── */

        .settings-advanced-toggle {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 0;
          margin: 8px 0;
          background: none;
          border: none;
          cursor: pointer;
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--color-text-ghost);
          transition: color 0.15s ease;
        }

        .settings-advanced-toggle:hover {
          color: var(--color-text-dim);
        }

        .settings-advanced-toggle svg {
          width: 14px;
          height: 14px;
          transition: transform 0.2s ease;
        }

        .settings-advanced-toggle.expanded svg {
          transform: rotate(180deg);
        }

        /* ─── Placeholder page ─── */

        .settings-placeholder {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 300px;
          gap: 12px;
          color: var(--color-text-ghost);
        }

        .settings-placeholder-icon {
          font-size: 36px;
          opacity: 0.4;
        }

        .settings-placeholder-text {
          font-family: var(--font-mono);
          font-size: 13px;
        }

        @media (max-width: 900px) {
          .settings-view {
            grid-template-columns: 200px 1fr;
          }

          .settings-content {
            padding: 16px 20px 24px;
          }

          .settings-header {
            padding: 16px 20px 12px;
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
