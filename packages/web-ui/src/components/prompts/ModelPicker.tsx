// ═══════════════════════════════════════════════════════════════════════════
// Model Picker - Searchable combobox for OpenRouter model selection
// Features: provider grouping, fuzzy search on id, context length + pricing display
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { fetchModels, type OpenRouterModel } from '../../lib/models-api';

interface ModelPickerProps {
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
}

export function ModelPicker({ value, onChange, disabled }: ModelPickerProps) {
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch models on first open
  const loadModels = useCallback(async () => {
    if (models.length > 0 || loading) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchModels();
      setModels(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load models');
    } finally {
      setLoading(false);
    }
  }, [models.length, loading]);

  // Filter models by search
  const filtered = useMemo(() => {
    if (!search.trim()) return models;
    const terms = search.toLowerCase().split(/\s+/);
    return models.filter((m) => {
      const haystack = m.id.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [models, search]);

  // Group filtered models by provider
  const grouped = useMemo(() => {
    const groups = new Map<string, OpenRouterModel[]>();
    for (const m of filtered) {
      const provider = m.id.split('/')[0] ?? 'unknown';
      const list = groups.get(provider) ?? [];
      list.push(m);
      groups.set(provider, list);
    }
    return groups;
  }, [filtered]);

  // Flat list for keyboard navigation
  const flatList = useMemo(() => filtered, [filtered]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const item = listRef.current.querySelector(`[data-index="${highlightIndex}"]`);
    item?.scrollIntoView({ block: 'nearest' });
  }, [highlightIndex, open]);

  const handleOpen = () => {
    if (disabled) return;
    setOpen(true);
    setSearch('');
    setHighlightIndex(0);
    loadModels();
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleSelect = (modelId: string) => {
    onChange(modelId);
    setOpen(false);
    setSearch('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, flatList.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = flatList[highlightIndex];
      if (item) handleSelect(item.id);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const formatPrice = (price: string) => {
    const num = parseFloat(price);
    if (num === 0) return 'free';
    if (num < 0.000001) return '<$0.01/M';
    return `$${(num * 1_000_000).toFixed(2)}/M`;
  };

  const formatContext = (len: number) => {
    if (len >= 1_000_000) return `${(len / 1_000_000).toFixed(1)}M`;
    if (len >= 1_000) return `${Math.round(len / 1_000)}k`;
    return `${len}`;
  };

  // Extract provider from current value for display
  const displayValue = value || 'Select model...';

  return (
    <div className="model-picker" ref={containerRef}>
      <style>{`
        .model-picker {
          position: relative;
          width: 100%;
        }

        .model-picker-trigger {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 8px 12px;
          background: rgba(10, 10, 15, 0.8);
          border: 1px solid var(--color-glass-border);
          border-radius: 6px;
          font-family: var(--font-mono);
          font-size: 12px;
          color: var(--color-text-normal);
          cursor: pointer;
          transition: border-color 0.15s ease;
          text-align: left;
        }

        .model-picker-trigger:hover:not(:disabled) {
          border-color: var(--color-cyan-dim);
        }

        .model-picker-trigger:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .model-picker-trigger-text {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .model-picker-trigger-arrow {
          color: var(--color-text-ghost);
          font-size: 10px;
          flex-shrink: 0;
        }

        .model-picker-dropdown {
          position: absolute;
          top: calc(100% + 4px);
          left: 0;
          right: 0;
          z-index: 100;
          background: rgba(8, 8, 14, 0.98);
          border: 1px solid var(--color-glass-border);
          border-radius: 8px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
          overflow: hidden;
          max-height: 400px;
          display: flex;
          flex-direction: column;
        }

        .model-picker-search {
          padding: 10px 12px;
          border-bottom: 1px solid var(--color-glass-border);
          flex-shrink: 0;
        }

        .model-picker-search input {
          width: 100%;
          padding: 6px 10px;
          background: rgba(15, 15, 24, 0.8);
          border: 1px solid var(--color-glass-border);
          border-radius: 4px;
          font-family: var(--font-mono);
          font-size: 12px;
          color: var(--color-text-normal);
          outline: none;
        }

        .model-picker-search input:focus {
          border-color: var(--color-cyan);
        }

        .model-picker-search input::placeholder {
          color: var(--color-text-ghost);
        }

        .model-picker-list {
          overflow-y: auto;
          flex: 1;
          max-height: 340px;
        }

        .model-picker-list::-webkit-scrollbar {
          width: 6px;
        }

        .model-picker-list::-webkit-scrollbar-track {
          background: transparent;
        }

        .model-picker-list::-webkit-scrollbar-thumb {
          background: rgba(56, 189, 248, 0.2);
          border-radius: 3px;
        }

        .model-picker-group-header {
          padding: 6px 12px;
          font-family: var(--font-mono);
          font-size: 10px;
          font-weight: 600;
          color: var(--color-text-ghost);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          background: rgba(15, 15, 24, 0.4);
          position: sticky;
          top: 0;
          z-index: 1;
        }

        .model-picker-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          cursor: pointer;
          transition: background 0.1s ease;
        }

        .model-picker-item:hover,
        .model-picker-item[data-highlighted="true"] {
          background: rgba(56, 189, 248, 0.08);
        }

        .model-picker-item[data-selected="true"] {
          background: rgba(56, 189, 248, 0.12);
        }

        .model-picker-item-id {
          flex: 1;
          font-family: var(--font-mono);
          font-size: 12px;
          color: var(--color-text-normal);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .model-picker-item-meta {
          display: flex;
          gap: 8px;
          flex-shrink: 0;
        }

        .model-picker-item-badge {
          padding: 2px 6px;
          border-radius: 3px;
          font-family: var(--font-mono);
          font-size: 10px;
          white-space: nowrap;
        }

        .model-picker-item-ctx {
          background: rgba(139, 92, 246, 0.12);
          color: rgba(139, 92, 246, 0.8);
        }

        .model-picker-item-price {
          background: rgba(52, 211, 153, 0.12);
          color: rgba(52, 211, 153, 0.8);
        }

        .model-picker-empty {
          padding: 24px 12px;
          text-align: center;
          font-family: var(--font-mono);
          font-size: 12px;
          color: var(--color-text-ghost);
        }

        .model-picker-count {
          padding: 6px 12px;
          border-top: 1px solid var(--color-glass-border);
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-ghost);
          text-align: right;
          flex-shrink: 0;
        }
      `}</style>

      {/* Trigger button */}
      <button
        className="model-picker-trigger"
        onClick={handleOpen}
        disabled={disabled}
        type="button"
      >
        <span className="model-picker-trigger-text">{displayValue}</span>
        <span className="model-picker-trigger-arrow">▼</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="model-picker-dropdown">
          <div className="model-picker-search">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setHighlightIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search models... (e.g. kimi, grok, claude)"
            />
          </div>

          <div className="model-picker-list" ref={listRef}>
            {loading && (
              <div className="model-picker-empty">Loading models...</div>
            )}
            {error && (
              <div className="model-picker-empty" style={{ color: 'var(--color-rose)' }}>
                {error}
              </div>
            )}
            {!loading && !error && flatList.length === 0 && (
              <div className="model-picker-empty">No models found</div>
            )}
            {!loading && !error && Array.from(grouped.entries()).map(([provider, providerModels]) => (
              <div key={provider}>
                <div className="model-picker-group-header">{provider}</div>
                {providerModels.map((model) => {
                  const idx = flatList.indexOf(model);
                  return (
                    <div
                      key={model.id}
                      className="model-picker-item"
                      data-index={idx}
                      data-highlighted={idx === highlightIndex}
                      data-selected={model.id === value}
                      onClick={() => handleSelect(model.id)}
                    >
                      <span className="model-picker-item-id">
                        {model.id.split('/').slice(1).join('/')}
                      </span>
                      <div className="model-picker-item-meta">
                        <span className="model-picker-item-badge model-picker-item-ctx">
                          {formatContext(model.context_length)}
                        </span>
                        <span className="model-picker-item-badge model-picker-item-price">
                          {formatPrice(model.pricing.prompt)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {!loading && flatList.length > 0 && (
            <div className="model-picker-count">
              {flatList.length} model{flatList.length !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
