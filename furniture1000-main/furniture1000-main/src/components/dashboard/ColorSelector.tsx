import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { COLOR_MAP, getChineseColorLabel, getColorHex } from '@/constants/color-map';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Check, ChevronsUpDown, Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ColorSelectorProps {
  /** English W3C color name (stored value) */
  value: string;
  /** Callback with selected English W3C name */
  onChange: (englishName: string) => void;
  /** Compact mode for table cells */
  compact?: boolean;
  /** Optional className */
  className?: string;
  /** Placeholder text */
  placeholder?: string;
}

export function ColorSelector({
  value,
  onChange,
  compact = false,
  className,
  placeholder = '選擇顏色...',
}: ColorSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const displayLabel = value ? getChineseColorLabel(value) : '';
  const hexColor = value ? getColorHex(value) : '';

  const filteredColors = useMemo(() => {
    if (!search.trim()) return COLOR_MAP;
    const q = search.toLowerCase();
    return COLOR_MAP.filter(
      (c) =>
        c.cn.includes(search) ||
        c.en.toLowerCase().includes(q)
    );
  }, [search]);

  if (compact) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className={cn(
              'flex items-center gap-1.5 text-left font-mono-data text-xs transition-colors hover:text-foreground',
              !value && 'text-muted-foreground/50',
              className
            )}
          >
            {value ? (
              <>
                <span
                  className="h-3 w-3 rounded-full border border-border/50 flex-shrink-0"
                  style={{ backgroundColor: hexColor }}
                />
                <span className="truncate max-w-[80px]">{displayLabel}</span>
              </>
            ) : (
              <span>—</span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[240px] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="搜尋顏色..."
              className="font-body text-xs"
              value={search}
              onValueChange={setSearch}
            />
            <CommandList className="max-h-[200px]">
              <CommandEmpty>
                <span className="text-xs text-muted-foreground font-body py-2">找不到「{search}」</span>
              </CommandEmpty>
              <CommandGroup>
                {value && (
                  <CommandItem
                    value="__clear__"
                    onSelect={() => {
                      onChange('');
                      setOpen(false);
                      setSearch('');
                    }}
                    className="text-xs font-body text-muted-foreground"
                  >
                    清除選擇
                  </CommandItem>
                )}
                {filteredColors.map((c) => (
                  <CommandItem
                    key={c.en}
                    value={c.en}
                    onSelect={() => {
                      onChange(c.en);
                      setOpen(false);
                      setSearch('');
                    }}
                    className="gap-2 text-xs font-body"
                  >
                    <span
                      className="h-3 w-3 rounded-full border border-border/50 flex-shrink-0"
                      style={{ backgroundColor: c.hex }}
                    />
                    <span className="flex-1">{c.cn}</span>
                    <span className="text-[9px] text-muted-foreground/60 font-mono-data">{c.en}</span>
                    {value === c.en && <Check className="h-3 w-3 text-primary flex-shrink-0" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    );
  }

  // Full-size dropdown (for AI Processor / forms)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            'w-full justify-between h-8 font-body text-sm border-border bg-background hover:bg-accent/50 transition-colors',
            !value && 'text-muted-foreground',
            className
          )}
        >
          <div className="flex items-center gap-2 truncate">
            {value ? (
              <>
                <span
                  className="h-3.5 w-3.5 rounded-full border border-border/50 flex-shrink-0"
                  style={{ backgroundColor: hexColor }}
                />
                <span className="truncate">{displayLabel}</span>
                <span className="text-[10px] text-muted-foreground/60 font-mono-data">({value})</span>
              </>
            ) : (
              <>
                <Palette className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/70" />
                {placeholder}
              </>
            )}
          </div>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="搜尋顏色 (中英文)..."
            className="font-body text-sm"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList className="max-h-[250px]">
            <CommandEmpty>
              <span className="text-xs text-muted-foreground font-body py-3">找不到「{search}」</span>
            </CommandEmpty>
            <CommandGroup>
              {value && (
                <CommandItem
                  value="__clear__"
                  onSelect={() => {
                    onChange('');
                    setOpen(false);
                    setSearch('');
                  }}
                  className="text-xs font-body text-muted-foreground"
                >
                  清除選擇
                </CommandItem>
              )}
              {filteredColors.map((c) => (
                <CommandItem
                  key={c.en}
                  value={c.en}
                  onSelect={() => {
                    onChange(c.en);
                    setOpen(false);
                    setSearch('');
                  }}
                  className="gap-2 text-xs font-body"
                >
                  <span
                    className="h-3.5 w-3.5 rounded-full border border-border/50 flex-shrink-0"
                    style={{ backgroundColor: c.hex }}
                  />
                  <span className="flex-1">{c.cn}</span>
                  <span className="text-[10px] text-muted-foreground/60 font-mono-data">{c.en}</span>
                  {value === c.en && <Check className="h-3 w-3 text-primary flex-shrink-0" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
