import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command';

interface StaffNameComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  loading?: boolean;
  placeholder?: string;
  hasError?: boolean;
  id?: string;
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
  const [open, setOpen] = useState(false);

  const filteredOptions = useMemo(() => {
    const query = value.trim().toLowerCase();
    if (!query) return options;
    return options.filter((name) => name.toLowerCase().includes(query));
  }, [options, value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative">
          <input
            id={id}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => setOpen(true)}
            placeholder={placeholder}
            autoComplete="off"
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
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
        </div>
      </PopoverAnchor>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command shouldFilter={false}>
          <CommandList className="max-h-[220px]">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="font-body text-xs text-muted-foreground">
                  載入 PM 及設計師名單…
                </span>
              </div>
            ) : filteredOptions.length === 0 ? (
              <div className="px-3 py-4 text-center">
                <p className="font-body text-xs text-muted-foreground">
                  {value.trim()
                    ? `找不到「${value.trim()}」，可直接使用輸入的名稱`
                    : '尚無可選名單，請直接輸入姓名'}
                </p>
              </div>
            ) : (
              <CommandGroup>
                {filteredOptions.map((name) => (
                  <CommandItem
                    key={name}
                    value={name}
                    onSelect={() => {
                      onChange(name);
                      setOpen(false);
                    }}
                    className="cursor-pointer font-body text-sm"
                  >
                    <span className="flex-1 truncate">{name}</span>
                    {value.trim() === name && (
                      <Check className="h-3.5 w-3.5 text-primary" />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
