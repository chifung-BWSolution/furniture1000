import { supabase } from './supabase';

export interface FactoryItem {
  display_name: string;
  factory_id: string;
}

/**
 * Fetches the list of factory/manufacturer display names from the
 * external Supabase project's `factories` table.
 *
 * Uses the `fetch-factories` edge function to keep the external
 * service_role key hidden from the frontend.
 */
export async function fetchFactories(): Promise<string[]> {
  try {
    const { data, error } = await supabase.functions.invoke(
      'supabase-functions-fetch-factories'
    );

    if (error) {
      console.error('[fetchFactories] Edge function error:', error);
      return [];
    }

    if (data?.factories && Array.isArray(data.factories)) {
      return data.factories;
    }

    console.warn('[fetchFactories] Unexpected response shape:', data);
    return [];
  } catch (err) {
    console.error('[fetchFactories] Network error:', err);
    return [];
  }
}

/**
 * Fetches factory list WITH their IDs from the master project.
 * Returns an array of { display_name, factory_id } objects.
 */
export async function fetchFactoriesWithIds(): Promise<FactoryItem[]> {
  try {
    const { data, error } = await supabase.functions.invoke(
      'supabase-functions-fetch-factories'
    );

    if (error) {
      console.error('[fetchFactoriesWithIds] Edge function error:', error);
      return [];
    }

    if (data?.factoriesWithIds && Array.isArray(data.factoriesWithIds)) {
      return data.factoriesWithIds;
    }

    // Fallback: if only old-format factories array exists, return without IDs
    if (data?.factories && Array.isArray(data.factories)) {
      console.warn('[fetchFactoriesWithIds] No factoriesWithIds in response — returning names only');
      return data.factories.map((name: string) => ({ display_name: name, factory_id: '' }));
    }

    console.warn('[fetchFactoriesWithIds] Unexpected response shape:', data);
    return [];
  } catch (err) {
    console.error('[fetchFactoriesWithIds] Network error:', err);
    return [];
  }
}
