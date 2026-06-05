import { useState, useMemo, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { COLOR_MAP, getChineseColorLabel, getColorHex } from '@/constants/color-map';
import { X, Palette, Search, ChevronDown } from 'lucide-react';

interface MultiColorSelectorProps {
  /** Comma-separated English W3C color names (stored value) */
  value: string;
  /** Called with new comma-separated value */
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function MultiColorSelector({
  value,
  onChange,
  placeholder = '選擇顏色...',
  className,
}: MultiColorSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Parse comma-separated value into array
  const selectedColors = useMemo(
    () =>
      value
        ? value
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    [value]
  );

  const filteredColors = useMemo(() => {
    if (!search.trim()) return COLOR_MAP;
    const q = search.toLowerCase();
    return COLOR_MAP.filter(
      (c) => c.cn.includes(search) || c.en.toLowerCase().includes(q)
    );
  }, [search]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Focus search when dropdown opens
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50);
  }, [open]);

  const toggle = (colorEn: string) => {
    const next = selectedColors.includes(colorEn)
      ? selectedColors.filter((c) => c !== colorEn)
      : [...selectedColors, colorEn];
    onChange(next.join(','));
  };

  const clearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
  };

  return (
    <div ref={dropdownRef} className={cn('relative w-full', className)}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex min-h-[36px] w-full items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-left text-sm transition-colors hover:bg-accent/30 focus:outline-none focus:ring-2 focus:ring-primary/40',
          open && 'ring-2 ring-primary/40'
        )}
      >
        <Palette className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />

        <div className="flex flex-1 flex-wrap gap-1 min-w-0">
          {selectedColors.length === 0 ? (
            <span className="font-body text-sm text-muted-foreground">{placeholder}</span>
          ) : (
            selectedColors.map((colorEn) => {
              const hex = getColorHex(colorEn);
              const label = getChineseColorLabel(colorEn) || colorEn;
              return (
                <span
                  key={colorEn}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 font-body text-xs"
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full border border-border/40 flex-shrink-0"
                    style={{ backgroundColor: hex }}
                  />
                  {label}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(colorEn);
                    }}
                    className="ml-0.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {selectedColors.length > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="清除全部"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground/60 transition-transform', open && 'rotate-180')} />
        </div>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-background shadow-lg">
          {/* Search */}
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜尋顏色 (中英文)..."
              className="flex-1 bg-transparent font-body text-sm outline-none placeholder:text-muted-foreground"
            />
            {search && (
              <button onClick={() => setSearch('')} className="text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Selected summary + clear */}
          {selectedColors.length > 0 && (
            <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
              <span className="font-mono-data text-[11px] text-muted-foreground">
                已選 {selectedColors.length} 種顏色
              </span>
              <button
                onClick={() => onChange('')}
                className="font-body text-[11px] text-rose-500 hover:text-rose-600"
              >
                清除全部
              </button>
            </div>
          )}

          {/* Color list */}
          <div className="max-h-[260px] overflow-y-auto py-1">
            {filteredColors.length === 0 ? (
              <p className="px-3 py-4 text-center font-body text-xs text-muted-foreground">
                找不到「{search}」
              </p>
            ) : (
              filteredColors.map((c) => {
                const isSelected = selectedColors.includes(c.en);
                return (
                  <button
                    key={c.en}
                    type="button"
                    onClick={() => toggle(c.en)}
                    className={cn(
                      'flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accent/50',
                      isSelected && 'bg-primary/5'
                    )}
                  >
                    {/* Checkbox */}
                    <span
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                        isSelected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background'
                      )}
                    >
                      {isSelected && (
                        <svg className="h-2.5 w-2.5" viewBox="0 0 10 10" fill="none">
                          <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>

                    {/* Color swatch */}
                    <span
                      className="h-4 w-4 shrink-0 rounded-full border border-border/50"
                      style={{ backgroundColor: c.hex }}
                    />

                    {/* Labels */}
                    <span className="flex-1 font-body text-sm">{c.cn}</span>
                    <span className="font-mono-data text-[10px] text-muted-foreground/60">{c.en}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
