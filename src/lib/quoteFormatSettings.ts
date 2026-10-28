import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { quoteItemLineSubtotal, type QuoteLineItem } from '@/lib/quoteItemTotals';

export type ZoneSubtotalPlacement = 'section_and_summary' | 'summary_only' | 'hidden';

export type QuoteFormatSettings = {
  qrCaption: string;
  zoneSubtotalPlacement: ZoneSubtotalPlacement;
};

export const DEFAULT_QUOTE_FORMAT: QuoteFormatSettings = {
  qrCaption: '線上選擇／修改產品',
  zoneSubtotalPlacement: 'section_and_summary',
};

const PLACEMENTS = new Set<ZoneSubtotalPlacement>([
  'section_and_summary',
  'summary_only',
  'hidden',
]);

type SettingsRow = {
  qr_caption: string;
  zone_subtotal_placement: string;
};

type PostgrestError = { code?: string; message: string } | null;

type FormatTable = {
  select: (columns: string) => {
    eq: (
      column: string,
      value: boolean,
    ) => {
      maybeSingle: () => Promise<{ data: SettingsRow | null; error: PostgrestError }>;
    };
  };
  update: (patch: Record<string, unknown>) => {
    eq: (column: string, value: boolean) => Promise<{ error: PostgrestError }>;
  };
};

function formatTable(): FormatTable {
  return (supabase as unknown as { from: (table: string) => FormatTable }).from(
    'quote_format_settings',
  );
}

export function isMissingFormatTable(error: PostgrestError): boolean {
  if (!error) return false;
  const text = `${error.code ?? ''} ${error.message}`;
  return (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    /schema cache|does not exist|Could not find the table/i.test(text)
  );
}

function fromRow(row: SettingsRow): QuoteFormatSettings {
  const placement = PLACEMENTS.has(row.zone_subtotal_placement as ZoneSubtotalPlacement)
    ? (row.zone_subtotal_placement as ZoneSubtotalPlacement)
    : DEFAULT_QUOTE_FORMAT.zoneSubtotalPlacement;
  return {
    qrCaption: row.qr_caption.trim() || DEFAULT_QUOTE_FORMAT.qrCaption,
    zoneSubtotalPlacement: placement,
  };
}

export async function loadQuoteFormatSettings(): Promise<{
  settings: QuoteFormatSettings;
  missingTable: boolean;
  error: string | null;
}> {
  const { data, error } = await formatTable()
    .select(
      'qr_caption, zone_subtotal_placement',
    )
    .eq('id', true)
    .maybeSingle();
  if (error) {
    if (isMissingFormatTable(error)) {
      return { settings: DEFAULT_QUOTE_FORMAT, missingTable: true, error: null };
    }
    return { settings: DEFAULT_QUOTE_FORMAT, missingTable: false, error: error.message };
  }
  if (!data) return { settings: DEFAULT_QUOTE_FORMAT, missingTable: false, error: null };
  return { settings: fromRow(data), missingTable: false, error: null };
}

export async function saveQuoteFormatSettings(
  settings: QuoteFormatSettings,
): Promise<{ ok: boolean; missingTable: boolean; error: string | null }> {
  const { error } = await formatTable()
    .update({
      qr_caption: settings.qrCaption.trim() || DEFAULT_QUOTE_FORMAT.qrCaption,
      zone_subtotal_placement: settings.zoneSubtotalPlacement,
    })
    .eq('id', true);
  if (error) {
    if (isMissingFormatTable(error)) {
      return { ok: false, missingTable: true, error: '格式設定還沒準備好，暫時不能儲存。請聯絡管理員。' };
    }
    return { ok: false, missingTable: false, error: error.message };
  }
  return { ok: true, missingTable: false, error: null };
}

export function useQuoteFormatSettings() {
  const [settings, setSettings] = useState<QuoteFormatSettings>(DEFAULT_QUOTE_FORMAT);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void loadQuoteFormatSettings().then((result) => {
      if (cancelled) return;
      setSettings(result.settings);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { settings, loading };
}

export type QuoteZoneTotal = {
  name: string;
  amount: number;
  endIndex: number;
};

/** Subtotals for section-title groups already on the quote. Items before the first section are not a zone. */
export function quoteZoneTotals(items: Array<QuoteLineItem & { name?: string }>): QuoteZoneTotal[] {
  const zones: QuoteZoneTotal[] = [];
  let current: QuoteZoneTotal | null = null;
  items.forEach((item, index) => {
    if (item.isSectionTitle) {
      if (current) zones.push(current);
      current = {
        name: item.name?.trim() || '未命名分區',
        amount: 0,
        endIndex: index,
      };
      return;
    }
    if (!current) return;
    current.amount += quoteItemLineSubtotal(item);
    current.endIndex = index;
  });
  if (current) zones.push(current);
  return zones;
}
