import { supabase } from '@/lib/supabase';
import { loadManufacturerDirectory } from '@/lib/manufacturerDirectory';

export type FactoryZone = {
  id: string;
  name: string;
  note: string;
  sortOrder: number;
};

export type FactoryZoneMember = {
  zoneId: string;
  factoryId: string;
  factoryName: string;
};

export type DirectoryFactory = {
  id: string;
  name: string;
  location: string | null;
};

type PostgrestError = { code?: string; message: string } | null;

type ZoneRow = { id: string; name: string; note: string | null; sort_order: number };
type MemberRow = { zone_id: string; factory_id: string; factory_name: string | null };

type LooseTable = {
  select: (columns: string) => {
    order: (
      column: string,
      options: { ascending: boolean },
    ) => Promise<{ data: ZoneRow[] | null; error: PostgrestError }>;
  } & Promise<{ data: MemberRow[] | null; error: PostgrestError }>;
  insert: (row: Record<string, unknown>) => Promise<{ error: PostgrestError }>;
  delete: () => {
    eq: (column: string, value: string) => {
      eq: (column: string, value: string) => Promise<{ error: PostgrestError }>;
    } & Promise<{ error: PostgrestError }>;
  };
};

function table(name: string): LooseTable {
  return (supabase as unknown as { from: (table: string) => LooseTable }).from(name);
}

export function isMissingFactoryZoneTable(error: PostgrestError): boolean {
  if (!error) return false;
  const text = `${error.code ?? ''} ${error.message}`;
  return (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    /schema cache|does not exist|Could not find the table/i.test(text)
  );
}

export async function loadDirectoryFactories(): Promise<{ factories: DirectoryFactory[]; error: string | null }> {
  try {
    const rows = await loadManufacturerDirectory();
    const factories = rows
      .map((row) => ({
        id: String(row.id ?? ''),
        name: String(row.display_name ?? '').trim(),
        location: row.location == null ? null : String(row.location),
      }))
      .filter((row) => row.id && row.name);
    return { factories, error: null };
  } catch (err) {
    return { factories: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export async function loadFactoryZones(): Promise<{
  zones: FactoryZone[];
  members: FactoryZoneMember[];
  missingTable: boolean;
  error: string | null;
}> {
  const zonesResult = await table('factory_zones').select('id, name, note, sort_order').order('sort_order', {
    ascending: true,
  });
  if (zonesResult.error) {
    if (isMissingFactoryZoneTable(zonesResult.error)) {
      return { zones: [], members: [], missingTable: true, error: null };
    }
    return { zones: [], members: [], missingTable: false, error: zonesResult.error.message };
  }
  const membersResult = await table('factory_zone_members').select('zone_id, factory_id, factory_name');
  if (membersResult.error) {
    return { zones: [], members: [], missingTable: false, error: membersResult.error.message };
  }
  return {
    zones: (zonesResult.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      note: row.note ?? '',
      sortOrder: row.sort_order ?? 0,
    })),
    members: (membersResult.data ?? []).map((row) => ({
      zoneId: row.zone_id,
      factoryId: row.factory_id,
      factoryName: row.factory_name ?? '',
    })),
    missingTable: false,
    error: null,
  };
}

export async function createFactoryZone(name: string, note: string): Promise<{ error: string | null }> {
  const { error } = await table('factory_zones').insert({
    name: name.trim(),
    note: note.trim(),
    sort_order: 0,
  });
  return { error: error?.message ?? null };
}

export async function deleteFactoryZone(zoneId: string): Promise<{ error: string | null }> {
  const { error } = await table('factory_zones').delete().eq('id', zoneId);
  return { error: error?.message ?? null };
}

export async function addFactoryToZone(
  zoneId: string,
  factoryId: string,
  factoryName: string,
): Promise<{ error: string | null }> {
  const { error } = await table('factory_zone_members').insert({
    zone_id: zoneId,
    factory_id: factoryId,
    factory_name: factoryName,
  });
  return { error: error?.message ?? null };
}

export async function removeFactoryFromZone(zoneId: string, factoryId: string): Promise<{ error: string | null }> {
  const { error } = await table('factory_zone_members').delete().eq('zone_id', zoneId).eq('factory_id', factoryId);
  return { error: error?.message ?? null };
}
