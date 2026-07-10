import { useEffect, useState } from 'react';
import { Check, ChevronsUpDown, Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  fetchPmsPitchings,
  type PmsPitchingListItem,
} from '@/lib/pmsPitchings';

interface PmsPitchingSelectorProps {
  value?: string;
  selectedLabel?: string | null;
  disabled?: boolean;
  error?: string;
  onSelect: (item: PmsPitchingListItem) => void;
  onClear?: () => void;
}

export function PmsPitchingSelector({
  value,
  selectedLabel,
  disabled,
  error,
  onSelect,
  onClear,
}: PmsPitchingSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<PmsPitchingListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setLoadError(null);
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
  }, [open, search]);

  return (
    <div>
      <label className="mb-1.5 block font-body text-sm font-medium text-foreground">
        PMS Pitching <span className="text-red-500">*</span>
      </label>
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (disabled) return;
          setOpen(next);
          if (!next) setSearch('');
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              'h-auto min-h-10 w-full justify-between border bg-background px-4 py-2.5 font-body text-sm font-normal hover:bg-accent/50',
              !value && 'text-muted-foreground',
              error ? 'border-red-500' : 'border-border',
            )}
          >
            <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
              <Search className="h-3.5 w-3.5 shrink-0 text-primary/70" />
              <span className="truncate">
                {selectedLabel?.trim() ||
                  (value ? '已選 Pitching' : '搜尋並選擇 PMS Pitching…')}
              </span>
            </div>
            <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] p-0"
          align="start"
          side="bottom"
        >
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="搜尋 pitching code / 客戶名稱…"
              className="font-body text-sm"
              value={search}
              onValueChange={setSearch}
            />
            <CommandList className="max-h-[320px] overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-6">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="font-body text-xs text-muted-foreground">
                    載入中…
                  </span>
                </div>
              ) : (
                <>
                  <CommandEmpty className="py-4 text-center font-body text-xs text-muted-foreground">
                    {loadError ||
                      (search.trim()
                        ? `找不到「${search.trim()}」`
                        : '沒有可選的 Pitching')}
                  </CommandEmpty>
                  <CommandGroup>
                    {items.map((item) => {
                      const selected = item.id === value;
                      return (
                        <CommandItem
                          key={item.id}
                          value={item.id}
                          onSelect={() => {
                            onSelect(item);
                            setOpen(false);
                            setSearch('');
                          }}
                          className="cursor-pointer items-start gap-2 py-2.5"
                        >
                          <Check
                            className={cn(
                              'mt-0.5 h-3.5 w-3.5 shrink-0',
                              selected ? 'opacity-100 text-primary' : 'opacity-0',
                            )}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-mono-data text-xs font-semibold text-foreground">
                              {item.pitching_code || '—'}
                            </div>
                            <div className="mt-0.5 truncate font-body text-xs text-muted-foreground">
                              {item.customer_name || item.pitching_name || '未有客戶名稱'}
                              {item.main_pm_name ? ` · PM ${item.main_pm_name}` : ''}
                              {item.pitching_stages ? ` · ${item.pitching_stages}` : ''}
                            </div>
                          </div>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value && onClear && !disabled ? (
        <button
          type="button"
          onClick={onClear}
          className="mt-1.5 font-body text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          清除選擇
        </button>
      ) : null}
      {error ? <p className="mt-1 text-xs text-red-500">{error}</p> : null}
      {!error && !value ? (
        <p className="mt-1.5 font-body text-xs text-muted-foreground">
          必須關聯 PMS Pitching，選擇後會自動帶入客戶／產業／預算等資料
        </p>
      ) : null}
    </div>
  );
}
