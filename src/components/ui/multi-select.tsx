import { useId, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface MultiSelectOption {
  value: string;
  label: string;
  description?: string;
}

export function MultiSelect({ options, value, onValueChange, label, placeholder = '請選擇', maxSelected, disabled }: {
  options: MultiSelectOption[];
  value: string[];
  onValueChange: (value: string[]) => void;
  label: string;
  placeholder?: string;
  maxSelected?: number;
  disabled?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.filter((option) => value.includes(option.value));
  const filtered = options.filter((option) => `${option.label} ${option.description ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const atLimit = maxSelected !== undefined && value.length >= maxSelected;
  const remove = (key: string) => onValueChange(value.filter((item) => item !== key));

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery(''); }}>
        <PopoverAnchor asChild>
          <div className={`relative flex min-h-10 w-full items-center gap-3 rounded-md border border-input bg-background px-3 py-2 focus-within:ring-1 focus-within:ring-ring ${disabled ? 'opacity-50' : 'hover:border-primary/50'}`}>
            <PopoverTrigger asChild>
              <button type="button" disabled={disabled} aria-label={`${label}，已選 ${value.length} 個`}
                className="absolute inset-0 rounded-md focus-visible:outline-none disabled:cursor-not-allowed" />
            </PopoverTrigger>
            <div className="pointer-events-none relative min-w-0 flex-1">
              {selected.length > 0 ? (
                <ul aria-label={`已選${label}`} className="flex flex-wrap gap-1.5">
                  {selected.map((option) => (
                    <li key={option.value} className="flex max-w-full items-center gap-1 rounded-md bg-muted py-1 pl-2.5 pr-1 text-xs">
                      <span className="min-w-0 break-words">{option.label}</span>
                      <Button type="button" variant="ghost" size="icon" className="pointer-events-auto h-6 w-6 shrink-0" disabled={disabled}
                        aria-label={`移除${option.label}`} onClick={() => remove(option.value)}><X className="h-3 w-3" /></Button>
                    </li>
                  ))}
                </ul>
              ) : <span className="text-sm text-muted-foreground">{placeholder}</span>}
            </div>
            <span className="pointer-events-none relative flex shrink-0 items-center gap-3">
              {maxSelected !== undefined && <span className="text-xs tabular-nums text-muted-foreground">{value.length} / {maxSelected}</span>}
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
            </span>
          </div>
        </PopoverAnchor>
        <PopoverContent align="start" className="flex max-h-[min(28rem,var(--radix-popover-content-available-height))] w-[var(--radix-popover-trigger-width)] min-w-0 flex-col overflow-hidden rounded-xl p-0">
          <div className="relative shrink-0 border-b p-3">
            <Search className="pointer-events-none absolute left-6 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input aria-label={`搜尋${label}`} placeholder="搜尋名稱或行業…" value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
            {filtered.length === 0 ? <p className="px-3 py-8 text-center text-sm text-muted-foreground">{options.length ? '沒有符合的選項，請試試其他關鍵字。' : '目前沒有可選項目。'}</p> : (
              <ul className="space-y-1">
                {filtered.map((option, index) => {
                  const checked = value.includes(option.value);
                  const blocked = !checked && atLimit;
                  const optionId = `${id}-${index}`;
                  return (
                    <li key={option.value}>
                      <label htmlFor={optionId} className={`flex items-start gap-3 rounded-lg px-3 py-2.5 text-sm ${blocked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-muted'} ${checked ? 'bg-primary/5' : ''}`}>
                        <Checkbox id={optionId} className="mt-0.5" checked={checked} disabled={blocked} onCheckedChange={(next) => {
                          if (next === true && !checked && !atLimit) onValueChange([...value, option.value]);
                          else if (next !== true) remove(option.value);
                        }} />
                        <span className="min-w-0 break-words leading-5">
                          <span className="block">{option.label}</span>
                          {option.description && <span className="mt-0.5 block text-xs text-muted-foreground">{option.description}</span>}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="flex shrink-0 items-center justify-between gap-2 border-t px-3 py-2">
            <p role="status" className="text-xs text-muted-foreground">{atLimit ? '已達選擇上限，取消勾選後可更換' : maxSelected !== undefined ? `最多選擇 ${maxSelected} 個` : `已選 ${value.length} 個`}</p>
            <Button type="button" variant="ghost" size="sm" disabled={!value.length} onClick={() => onValueChange([])}>清空</Button>
            <Button type="button" size="sm" onClick={() => setOpen(false)}>完成</Button>
          </div>
        </PopoverContent>
      </Popover>

    </div>
  );
}
