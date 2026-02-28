// ═══════════════════════════════════════════════════════════════════════════
// Settings Section - Reusable card with title, description, and grid fields
// ═══════════════════════════════════════════════════════════════════════════

import type { ReactNode } from 'react';

interface SettingsSectionProps {
  title: string;
  description?: string;
  columns?: 1 | 2 | 3;
  children: ReactNode;
}

export function SettingsSection({ title, description, columns, children }: SettingsSectionProps) {
  const colsClass = columns ? `cols-${columns}` : '';

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h3 className="settings-section-title">{title}</h3>
        {description && <p className="settings-section-desc">{description}</p>}
      </div>
      <div className={`settings-section-grid ${colsClass}`}>{children}</div>
    </div>
  );
}

interface SettingsFieldProps {
  label: string;
  hint?: string;
  fullWidth?: boolean;
  children: ReactNode;
}

export function SettingsField({ label, hint, fullWidth, children }: SettingsFieldProps) {
  return (
    <div className={`settings-field ${fullWidth ? 'full-width' : ''}`}>
      <label className="settings-field-label">{label}</label>
      {children}
      {hint && <span className="settings-field-hint">{hint}</span>}
    </div>
  );
}

interface AdvancedToggleProps {
  visible: boolean;
  onToggle: () => void;
}

export function AdvancedToggle({ visible, onToggle }: AdvancedToggleProps) {
  return (
    <button
      type="button"
      className={`settings-advanced-toggle ${visible ? 'expanded' : ''}`}
      onClick={onToggle}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m6 9 6 6 6-6" />
      </svg>
      {visible ? 'Hide advanced settings' : 'Show advanced settings'}
    </button>
  );
}
