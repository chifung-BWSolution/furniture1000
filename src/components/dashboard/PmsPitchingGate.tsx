import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  fetchPmsPitchings,
  type PmsPitchingListItem,
} from '@/lib/pmsPitchings';

interface PmsPitchingGateProps {
  onSelect: (item: PmsPitchingListItem) => void;
}

/**
 * Minimal first screen for 快速報價: search + select a PMS pitching.
 * After selection, the quote form wizard is revealed with prefilled data.
 */
export function PmsPitchingGate({ onSelect }: PmsPitchingGateProps) {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<PmsPitchingListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setLoadError(null);
      setActiveIndex(-1);
      const rows = await fetchPmsPitchings({ search, limit: 40 });
      if (cancelled) return;
      setItems(rows);
      setLoading(false);
      if (rows.length === 0 && !search.trim()) {
        setLoadError('未能載入 PMS Pitching 列表');
      }
    }, search.trim() ? 250 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && activeIndex >= 0 && items[activeIndex]) {
      e.preventDefault();
      onSelect(items[activeIndex]);
    }
  };

  return (
    <div className="flex h-full min-h-[60vh] items-center justify-center px-5 py-10">
      <div className="w-full max-w-xl">
        <div className="mb-8 text-center">
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            建立新報價單
          </h1>
          <p className="mt-2 font-body text-sm text-muted-foreground">
            先搜尋並選擇 PMS Pitching，系統會自動帶入報價資料
          </p>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="搜尋 pitching code / 客戶名稱…"
            className="w-full rounded-xl border border-border bg-card py-3.5 pl-11 pr-4 font-body text-sm text-foreground shadow-sm placeholder:text-muted-foreground/60 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            autoComplete="off"
          />
        </div>

        <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="font-body text-xs text-muted-foreground">載入中…</span>
            </div>
          ) : items.length === 0 ? (
            <div className="px-4 py-10 text-center font-body text-xs text-muted-foreground">
              {loadError ||
                (search.trim()
                  ? `找不到「${search.trim()}」`
                  : '輸入關鍵字開始搜尋，或瀏覽最近的 Pitching')}
            </div>
          ) : (
            <ul className="max-h-[min(420px,50vh)] overflow-y-auto py-1" role="listbox">
              {items.map((item, index) => (
                <li key={item.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => onSelect(item)}
                    className={cn(
                      'flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left transition-colors',
                      index === activeIndex
                        ? 'bg-primary/10'
                        : 'hover:bg-accent/60',
                    )}
                  >
                    <span className="font-mono-data text-sm font-semibold text-foreground">
                      {item.pitching_code || '—'}
                    </span>
                    <span className="truncate font-body text-xs text-muted-foreground">
                      {item.customer_name || item.pitching_name || '未有客戶名稱'}
                      {item.main_pm_name ? ` · PM ${item.main_pm_name}` : ''}
                      {item.pitching_stages ? ` · ${item.pitching_stages}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
