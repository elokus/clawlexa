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

  const filtered = useMemo(() => {
    if (!search.trim()) return models;
    const terms = search.toLowerCase().split(/\s+/);
    return models.filter((m) => {
      const haystack = m.id.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [models, search]);

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

  const flatList = useMemo(() => filtered, [filtered]);

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

  const displayValue = value || 'Select model...';

  return (
    <div className="relative w-full" ref={containerRef}>
      <button
        className="flex items-center gap-2 w-full px-3 py-2 bg-background border border-border rounded-md font-mono text-xs text-foreground cursor-pointer text-left hover:border-muted-foreground/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        onClick={handleOpen}
        disabled={disabled}
        type="button"
      >
        <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{displayValue}</span>
        <span className="text-muted-foreground text-[10px] shrink-0">▼</span>
      </button>

      {open && (
        <div className="absolute top-[calc(100%+4px)] left-0 right-0 z-[100] bg-card border border-border rounded-lg shadow-xl overflow-hidden max-h-[400px] flex flex-col">
          <div className="p-2.5 border-b border-border shrink-0">
            <input
              ref={inputRef}
              type="text"
              className="w-full px-2.5 py-1.5 bg-background border border-border rounded font-mono text-xs text-foreground focus:outline-none focus:border-ring placeholder:text-muted-foreground"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setHighlightIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search models... (e.g. kimi, grok, claude)"
            />
          </div>

          <div className="overflow-y-auto flex-1 max-h-[340px]" ref={listRef}>
            {loading && (
              <div className="py-6 text-center font-mono text-xs text-muted-foreground">Loading models...</div>
            )}
            {error && (
              <div className="py-6 text-center font-mono text-xs text-red-500">{error}</div>
            )}
            {!loading && !error && flatList.length === 0 && (
              <div className="py-6 text-center font-mono text-xs text-muted-foreground">No models found</div>
            )}
            {!loading && !error && Array.from(grouped.entries()).map(([provider, providerModels]) => (
              <div key={provider}>
                <div className="px-3 py-1.5 font-mono text-[10px] font-semibold text-muted-foreground uppercase tracking-wide bg-muted/50 sticky top-0 z-[1]">
                  {provider}
                </div>
                {providerModels.map((model) => {
                  const idx = flatList.indexOf(model);
                  return (
                    <div
                      key={model.id}
                      className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                        idx === highlightIndex
                          ? 'bg-accent'
                          : model.id === value
                          ? 'bg-accent/50'
                          : 'hover:bg-accent/50'
                      }`}
                      data-index={idx}
                      data-highlighted={idx === highlightIndex}
                      data-selected={model.id === value}
                      onClick={() => handleSelect(model.id)}
                    >
                      <span className="flex-1 font-mono text-xs text-foreground overflow-hidden text-ellipsis whitespace-nowrap">
                        {model.id.split('/').slice(1).join('/')}
                      </span>
                      <div className="flex gap-2 shrink-0">
                        <span className="px-1.5 py-0.5 rounded font-mono text-[10px] bg-purple-500/10 text-purple-500 whitespace-nowrap">
                          {formatContext(model.context_length)}
                        </span>
                        <span className="px-1.5 py-0.5 rounded font-mono text-[10px] bg-green-500/10 text-green-500 whitespace-nowrap">
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
            <div className="px-3 py-1.5 border-t border-border font-mono text-[10px] text-muted-foreground text-right shrink-0">
              {flatList.length} model{flatList.length !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
