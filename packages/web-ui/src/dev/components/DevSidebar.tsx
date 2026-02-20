// ═══════════════════════════════════════════════════════════════════════════
// Dev Sidebar - Component selector with categories
// ═══════════════════════════════════════════════════════════════════════════

import type { DemoConfig, DemoCategory } from '../registry';
import { getDemosByCategory, categoryMeta } from '../registry';

interface DevSidebarProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function DevSidebar({ selectedId, onSelect }: DevSidebarProps) {
  const demosByCategory = getDemosByCategory();

  // Sort categories by order
  const sortedCategories = Array.from(demosByCategory.entries()).sort(
    ([a], [b]) => categoryMeta[a].order - categoryMeta[b].order
  );

  return (
    <aside className="dev-sidebar">
      <style>{`
        .dev-sidebar {
          width: 280px;
          height: 100%;
          background: var(--color-surface);
          border-right: 1px solid var(--color-border);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .sidebar-header {
          padding: 16px 20px;
          border-bottom: 1px solid var(--color-border);
        }

        .sidebar-title {
          font-family: var(--font-display);
          font-size: 14px;
          font-weight: 600;
          letter-spacing: 0.1em;
          color: var(--color-text-bright);
          margin: 0 0 4px 0;
        }

        .sidebar-subtitle {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-dim);
        }

        .sidebar-content {
          flex: 1;
          overflow-y: auto;
          padding: 12px 0;
        }

        .category-section {
          margin-bottom: 16px;
        }

        .category-header {
          padding: 8px 20px;
          font-family: var(--font-mono);
          font-size: 9px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--color-text-ghost);
        }

        .demo-list {
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .demo-item {
          display: block;
          width: 100%;
          padding: 10px 20px;
          background: transparent;
          border: none;
          text-align: left;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .demo-item:hover {
          background: rgba(255, 255, 255, 0.03);
        }

        .demo-item.selected {
          background: rgba(56, 189, 248, 0.08);
          border-left: 2px solid var(--color-cyan);
        }

        .demo-name {
          display: block;
          font-family: var(--font-sans);
          font-size: 13px;
          color: var(--color-text-normal);
          margin-bottom: 2px;
        }

        .demo-item.selected .demo-name {
          color: var(--color-cyan);
        }

        .demo-desc {
          display: block;
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-dim);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .sidebar-footer {
          padding: 12px 20px;
          border-top: 1px solid var(--color-border);
          font-family: var(--font-mono);
          font-size: 9px;
          color: var(--color-text-ghost);
        }

        .footer-link {
          color: var(--color-cyan);
          text-decoration: none;
        }

        .footer-link:hover {
          text-decoration: underline;
        }
      `}</style>

      <div className="sidebar-header">
        <h1 className="sidebar-title">Component Lab</h1>
        <p className="sidebar-subtitle">Isolated component demos</p>
      </div>

      <div className="sidebar-content">
        {sortedCategories.map(([category, demos]) => (
          <div key={category} className="category-section">
            <div className="category-header">{categoryMeta[category].name}</div>
            <ul className="demo-list">
              {demos.map((demo) => (
                <li key={demo.id}>
                  <button
                    type="button"
                    className={`demo-item ${selectedId === demo.id ? 'selected' : ''}`}
                    onClick={() => onSelect(demo.id)}
                  >
                    <span className="demo-name">{demo.name}</span>
                    <span className="demo-desc">{demo.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {sortedCategories.length === 0 && (
          <div className="category-section">
            <div className="category-header">No demos registered</div>
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <a href="/" className="footer-link">&larr; Back to app</a>
      </div>
    </aside>
  );
}
