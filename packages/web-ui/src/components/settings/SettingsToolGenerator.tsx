import { SettingsSection } from './SettingsSection';

export function SettingsToolGenerator() {
  return (
    <>
      <SettingsSection
        title="Tool Generator"
        description="Prototype page for generating tools from templates. This is a placeholder and does not create runtime tools yet."
        columns={1}
      >
        <div className="settings-toolgen-card">
          <div className="settings-toolgen-title">Coming Soon</div>
          <p className="settings-toolgen-text">
            This page will generate tool scaffolds and manifest files under
            <code> .voiceclaw/tools/*</code>.
          </p>
          <button type="button" className="settings-toolgen-btn" disabled>
            Generate Tool (Disabled)
          </button>
        </div>
      </SettingsSection>

      <style>{`
        .settings-toolgen-card {
          border: 1px dashed var(--border);
          background: color-mix(in oklch, var(--muted) 35%, transparent);
          border-radius: 8px;
          padding: 16px;
        }

        .settings-toolgen-title {
          font-family: var(--font-sans);
          font-size: 14px;
          font-weight: 600;
          color: var(--foreground);
          margin-bottom: 8px;
        }

        .settings-toolgen-text {
          margin: 0 0 14px;
          font-family: var(--font-sans);
          font-size: 12px;
          line-height: 1.5;
          color: var(--muted-foreground);
        }

        .settings-toolgen-text code {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--foreground);
          background: color-mix(in oklch, var(--muted) 60%, transparent);
          padding: 2px 4px;
          border-radius: 4px;
        }

        .settings-toolgen-btn {
          min-height: auto;
          min-width: auto;
          padding: 8px 12px;
          border-radius: 6px;
          border: 1px solid var(--border);
          background: var(--muted);
          color: var(--muted-foreground);
          font-family: var(--font-sans);
          font-size: 12px;
          cursor: not-allowed;
          opacity: 0.7;
        }
      `}</style>
    </>
  );
}
