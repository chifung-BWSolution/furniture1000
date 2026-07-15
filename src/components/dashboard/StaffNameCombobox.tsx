import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StaffNameComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  loading?: boolean;
  placeholder?: string;
  hasError?: boolean;
  id?: string;
}

function filterStaffOptions(options: string[], query: string): string[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return options;
  return options.filter((name) => name.toLowerCase().includes(normalized));
}

export function StaffNameCombobox({
  value,
  onChange,
  options,
  loading = false,
  placeholder = '請輸入或選擇姓名',
  hasError = false,
  id,
}: StaffNameComboboxProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const query = value.trim();
  const filteredOptions = useMemo(
    () => filterStaffOptions(options, value),
    [options, value],
  );

  // Empty input → show full list; typed input → show matches only.
  const visibleOptions = query ? filteredOptions : options;
  const showDropdown = open && (loading || visibleOptions.length > 0);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (containerRef.current?.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={showDropdown}
        aria-autocomplete="list"
        aria-controls={id ? `${id}-listbox` : undefined}
        className={cn(
          'w-full rounded-lg border bg-background px-4 py-2.5 pr-10 font-body text-sm text-foreground placeholder:text-muted-foreground/50 transition-all focus:outline-none focus:ring-2',
          hasError
            ? 'border-rose-400/60 focus:border-rose-400/60 focus:ring-rose-400/20'
            : 'border-border focus:border-primary/50 focus:ring-primary/20',
        )}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="展開 PM 及設計師名單"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((prev) => !prev)}
        className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <ChevronsUpDown className="h-4 w-4 opacity-60" />
      </button>

      {showDropdown && (
        <div
          id={id ? `${id}-listbox` : undefined}
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-md"
        >
          {loading ? (
            <div className="flex items-center justify-center gap-2 px-3 py-4">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="font-body text-xs text-muted-foreground">
                載入 PM 及設計師名單…
              </span>
            </div>
          ) : (
            <ul className="max-h-[220px] overflow-y-auto p-1">
              {visibleOptions.map((name) => {
                const selected = query === name;
                return (
                  <li key={name} role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        onChange(name);
                        setOpen(false);
                      }}
                      className={cn(
                        'flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left font-body text-sm transition-colors hover:bg-accent',
                        selected && 'bg-accent/70',
                      )}
                    >
                      <span className="flex-1 truncate">{name}</span>
                      {selected && (
                        <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
