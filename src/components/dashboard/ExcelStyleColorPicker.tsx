import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

/** Quick swatches shown above「自訂顏色」— includes yellow. */
export const MATERIAL_QUICK_COLORS: Array<{ label: string; value: string }> = [
  { label: '預設', value: '' },
  { label: '黑', value: '#1a1a1a' },
  { label: '紅', value: '#dc2626' },
  { label: '橙', value: '#ea580c' },
  { label: '黃', value: '#eab308' },
  { label: '綠', value: '#16a34a' },
  { label: '藍', value: '#2563eb' },
  { label: '紫', value: '#7c3aed' },
  { label: '灰', value: '#6b7280' },
];

function hslToHex(h: number, s: number, l: number): string {
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const lit = Math.max(0, Math.min(100, l)) / 100;
  const a = sat * Math.min(lit, 1 - lit);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = lit - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Excel-like「標準」palette: saturated hues around the rim, lighter toward white center,
 * plus a grayscale bar. Rendered as hexagon cells.
 */
function buildStandardHoneycomb(): string[][] {
  // Hue ring order similar to Excel standard (blue → purple → red → orange → yellow → green).
  const hues = [210, 240, 270, 300, 330, 0, 20, 40, 55, 80, 120, 160, 185];
  const rows: string[][] = [];

  // Outer → inner rings (darker/saturated → lighter)
  const rings: Array<{ s: number; l: number }> = [
    { s: 90, l: 38 },
    { s: 85, l: 48 },
    { s: 75, l: 58 },
    { s: 65, l: 68 },
    { s: 55, l: 78 },
    { s: 35, l: 88 },
  ];

  // Build a hexagonal-ish triangular layout: short rows at top/bottom, longest in middle.
  // We map ring×hue into staggered rows for visual honeycomb.
  const rowLens = [7, 9, 11, 13, 13, 11, 9, 7];
  let hueCursor = 0;
  let ringCursor = 0;

  for (const len of rowLens) {
    const row: string[] = [];
    for (let i = 0; i < len; i++) {
      const hue = hues[hueCursor % hues.length];
      const ring = rings[Math.min(ringCursor, rings.length - 1)];
      // Mix ring by column so center columns are lighter (Excel white-center feel).
      const center = (len - 1) / 2;
      const dist = Math.abs(i - center) / Math.max(center, 1);
      const l = ring.l + (1 - dist) * 10;
      const s = ring.s * (0.55 + dist * 0.45);
      row.push(hslToHex(hue, s, l));
      hueCursor += 1;
    }
    rows.push(row);
    ringCursor += 1;
    hueCursor += 2; // rotate starting hue per row
  }

  // Ensure white near center of middle rows
  const mid = Math.floor(rows.length / 2);
  if (rows[mid]) {
    const c = Math.floor(rows[mid].length / 2);
    rows[mid][c] = '#ffffff';
    if (rows[mid][c - 1]) rows[mid][c - 1] = '#f3f4f6';
    if (rows[mid][c + 1]) rows[mid][c + 1] = '#e5e7eb';
  }

  return rows;
}

const STANDARD_GRAYS = [
  '#ffffff',
  '#f3f4f6',
  '#e5e7eb',
  '#d1d5db',
  '#9ca3af',
  '#6b7280',
  '#4b5563',
  '#374151',
  '#1f2937',
  '#111827',
  '#000000',
];

const STANDARD_HONEYCOMB = buildStandardHoneycomb();

function HexSwatch({
  color,
  selected,
  size = 16,
  onPick,
  title,
}: {
  color: string;
  selected?: boolean;
  size?: number;
  onPick: (color: string) => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title || color}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onPick(color)}
      className={cn(
        'shrink-0 border border-black/15 transition-transform hover:scale-110 hover:z-10',
        selected && 'ring-2 ring-primary ring-offset-1',
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        clipPath:
          'polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)',
      }}
      aria-label={title || color}
    />
  );
}

interface ExcelStyleColorPickerProps {
  activeColor?: string;
  onPick: (color: string) => void;
  onClear?: () => void;
  onClose?: () => void;
}

export function ExcelStyleColorPicker({
  activeColor = '',
  onPick,
  onClear,
  onClose,
}: ExcelStyleColorPickerProps) {
  const [panel, setPanel] = useState<'quick' | 'palette'>('quick');
  const [tab, setTab] = useState<'standard' | 'custom'>('standard');
  const [draft, setDraft] = useState(
    activeColor && /^#/.test(activeColor) ? activeColor : '#1a1a1a',
  );

  const preview = useMemo(() => {
    if (tab === 'custom') return draft;
    return activeColor && /^#/.test(activeColor) ? activeColor : draft;
  }, [activeColor, draft, tab]);

  if (panel === 'quick') {
    return (
      <div className="w-[168px] rounded-md border border-border bg-popover p-1.5 shadow-md">
        <div className="grid grid-cols-5 gap-1">
          {MATERIAL_QUICK_COLORS.map((c) => (
            <button
              key={c.label}
              type="button"
              title={c.label}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (!c.value) onClear?.();
                else onPick(c.value);
                onClose?.();
              }}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded border border-border/70',
                !c.value &&
                  'bg-background text-[10px] font-semibold text-muted-foreground',
                activeColor === c.value && 'ring-2 ring-primary/50',
              )}
              style={c.value ? { backgroundColor: c.value } : undefined}
            >
              {!c.value ? 'A' : null}
            </button>
          ))}
        </div>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setPanel('palette');
            setTab('standard');
          }}
          className="mt-1.5 flex w-full items-center gap-1.5 rounded px-1 py-1.5 text-left text-[11px] font-medium text-foreground hover:bg-muted"
        >
          <span
            className="inline-block h-4 w-4 rounded-sm border border-border"
            style={{
              background:
                'conic-gradient(#f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
            }}
          />
          自訂顏色…
        </button>
      </div>
    );
  }

  return (
    <div className="w-[280px] rounded-lg border border-border bg-popover p-2.5 shadow-xl">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-display text-sm font-bold text-foreground">色彩</p>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setPanel('quick')}
          className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          返回
        </button>
      </div>

      <div className="mb-2 flex border-b border-border">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setTab('standard')}
          className={cn(
            'flex-1 border-b-2 px-2 py-1.5 text-[12px] font-semibold transition-colors',
            tab === 'standard'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          標準
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setTab('custom')}
          className={cn(
            'flex-1 border-b-2 px-2 py-1.5 text-[12px] font-semibold transition-colors',
            tab === 'custom'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          自訂
        </button>
      </div>

      {tab === 'standard' ? (
        <div className="space-y-2">
          <div className="flex flex-col items-center gap-0.5 py-1">
            {STANDARD_HONEYCOMB.map((row, ri) => (
              <div
                key={`row-${ri}`}
                className="flex items-center justify-center gap-0.5"
                style={{ marginLeft: ri % 2 === 1 ? 8 : 0 }}
              >
                {row.map((color, ci) => (
                  <HexSwatch
                    key={`${ri}-${ci}-${color}`}
                    color={color}
                    size={15}
                    selected={activeColor?.toLowerCase() === color.toLowerCase()}
                    onPick={(c) => {
                      setDraft(c);
                      onPick(c);
                      onClose?.();
                    }}
                  />
                ))}
              </div>
            ))}
          </div>

          <div className="flex items-center justify-center gap-0.5 border-t border-border pt-2">
            {STANDARD_GRAYS.map((color) => (
              <HexSwatch
                key={color}
                color={color}
                size={15}
                selected={activeColor?.toLowerCase() === color.toLowerCase()}
                onPick={(c) => {
                  setDraft(c);
                  onPick(c);
                  onClose?.();
                }}
              />
            ))}
            <div className="ml-2 flex flex-col items-center gap-0.5">
              <span className="text-[10px] text-muted-foreground">選取</span>
              <HexSwatch
                color={preview || '#000000'}
                size={22}
                selected
                onPick={() => {}}
                title="目前選取"
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3 px-1 py-1">
          <p className="text-[11px] text-muted-foreground">
            拖曳調色盤或輸入色碼，選擇任意顏色。
          </p>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={/^#/.test(draft) ? draft : '#1a1a1a'}
              onMouseDown={(e) => e.stopPropagation()}
              onChange={(e) => setDraft(e.target.value)}
              className="h-16 w-16 cursor-pointer rounded border border-border bg-transparent p-0"
              title="調色盤"
            />
            <div className="min-w-0 flex-1 space-y-2">
              <label className="block text-[11px] text-muted-foreground">
                色碼
                <input
                  type="text"
                  value={draft}
                  onChange={(e) => {
                    const next = e.target.value.trim();
                    setDraft(next.startsWith('#') ? next : `#${next}`);
                  }}
                  className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-foreground"
                  placeholder="#eab308"
                  maxLength={9}
                />
              </label>
              <div
                className="h-8 w-full rounded-md border border-border"
                style={{ backgroundColor: /^#/.test(draft) ? draft : '#1a1a1a' }}
              />
            </div>
          </div>
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setPanel('quick')}
              className="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted"
            >
              取消
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const color = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(
                  draft,
                )
                  ? draft
                  : '#1a1a1a';
                onPick(color);
                onClose?.();
              }}
              className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90"
            >
              確定
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
