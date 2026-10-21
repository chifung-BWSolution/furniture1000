import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';

export interface SearchComboboxOption {
  id: string;
  label: string;
  hint?: string | null;
}

export function PresentationSearchCombobox({
  value,
  placeholder,
  options,
  loading,
  emptyText,
  ariaLabel,
  onText,
  onPick,
}: {
  value: string;
  placeholder: string;
  options: SearchComboboxOption[];
  loading?: boolean;
  emptyText: string;
  ariaLabel: string;
  onText: (value: string) => void;
  onPick: (option: SearchComboboxOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const query = value.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!query) return options;
    return options.filter((option) => {
      const label = option.label.toLowerCase();
      const hint = (option.hint ?? '').toLowerCase();
      return label.includes(query) || hint.includes(query);
    });
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <Input
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        className="h-10 rounded-lg bg-background"
        value={value}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(event) => {
          onText(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {loading ? <li className="px-2 py-2 text-sm text-muted-foreground">載入中…</li> : null}
          {!loading && filtered.length === 0 ? (
            <li className="px-2 py-2 text-sm text-muted-foreground">{emptyText}</li>
          ) : null}
          {filtered.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                role="option"
                className="flex w-full min-h-11 flex-col items-start justify-center rounded-md px-2 py-1.5 text-left hover:bg-muted"
                onMouseDown={(event) => {
                  event.preventDefault();
                  onPick(option);
                  setOpen(false);
                }}
              >
                <span className="text-sm text-foreground">{option.label}</span>
                {option.hint ? <span className="text-xs text-muted-foreground">{option.hint}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
