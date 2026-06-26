/**
 * useFactoryLearning
 * ──────────────────────────────────────────────────────────────────
 * Provides a "continuous improvement" feedback loop for the factory
 * parser.  When a user manually corrects a field in the AI Processor,
 * the correction is persisted to `factory_correction_patterns` in
 * Supabase.  On the next upload for the same factory the corrections
 * are pre-loaded and applied during / after parsing so the same
 * mistake is not repeated.
 *
 * Supported correctable fields:
 *   title | titleEn | titleZh | costPrice | description | material
 *   collection | color | dimensions
 */

import { useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

// ─── Types ────────────────────────────────────────────────────────

export interface CorrectionPattern {
  id?: string;
  factoryId: string;
  factoryName: string;
  fieldName: string;
  originalValue: string | null;
  correctedValue: string;
  modelNumber?: string | null;
  correctionContext?: Record<string, unknown>;
  occurrenceCount?: number;
}

export type CorrectableField =
  | 'title'
  | 'titleEn'
  | 'titleZh'
  | 'costPrice'
  | 'description'
  | 'material'
  | 'collection'
  | 'color'
  | 'dimensions';

/** Map from field name → DB column name (snake_case) for easy lookup */
const FIELD_TO_DB: Record<CorrectableField, string> = {
  title:       'title',
  titleEn:     'title_en',
  titleZh:     'title_zh',
  costPrice:   'cost_price',
  description: 'description',
  material:    'material',
  collection:  'collection',
  color:       'color',
  dimensions:  'dimensions',
};

// ─── Hook ─────────────────────────────────────────────────────────

export function useFactoryLearning(factoryId: string, factoryName: string) {
  /**
   * In-memory cache: factoryId → list of corrections loaded from DB.
   * Using a ref so it survives re-renders without triggering them.
   */
  const correctionCache = useRef<Record<string, CorrectionPattern[]>>({});

  // Pre-load corrections whenever the factory changes
  useEffect(() => {
    if (!factoryId) return;
    loadCorrections(factoryId).then((patterns) => {
      correctionCache.current[factoryId] = patterns;
      if (patterns.length > 0) {
        console.log(
          `[FactoryLearning] Loaded ${patterns.length} correction patterns for factory "${factoryId}"`,
        );
      }
    });
  }, [factoryId]);

  // ── Public API ──────────────────────────────────────────────────

  /**
   * Save a user correction to the DB.
   * Upserts: if the same (factory, field, originalValue, modelNumber)
   * combination already exists its occurrence_count is incremented.
   */
  const saveCorrection = useCallback(
    async (
      field: CorrectableField,
      originalValue: string | null,
      correctedValue: string,
      modelNumber?: string | null,
      context?: Record<string, unknown>,
    ) => {
      if (!factoryId || !correctedValue) return;

      // Optimistically update in-memory cache
      const existing = correctionCache.current[factoryId] || [];
      const idx = existing.findIndex(
        (c) =>
          c.fieldName === field &&
          c.originalValue === (originalValue ?? null) &&
          c.modelNumber === (modelNumber ?? null),
      );
      if (idx >= 0) {
        existing[idx] = {
          ...existing[idx],
          correctedValue,
          occurrenceCount: (existing[idx].occurrenceCount ?? 1) + 1,
        };
      } else {
        existing.push({
          factoryId,
          factoryName,
          fieldName: field,
          originalValue: originalValue ?? null,
          correctedValue,
          modelNumber: modelNumber ?? null,
          correctionContext: context ?? {},
          occurrenceCount: 1,
        });
      }
      correctionCache.current[factoryId] = existing;

      // Persist to Supabase
      try {
        const { error } = await supabase.rpc('upsert_factory_correction', {
          p_factory_id:    factoryId,
          p_factory_name:  factoryName,
          p_field_name:    field,
          p_original_value: originalValue ?? null,
          p_corrected_value: correctedValue,
          p_model_number:  modelNumber ?? null,
          p_context:       context ?? {},
        });

        if (error) {
          // Fallback: plain insert / update without RPC
          await upsertCorrectionFallback({
            factoryId,
            factoryName,
            fieldName: field,
            originalValue: originalValue ?? null,
            correctedValue,
            modelNumber: modelNumber ?? null,
            correctionContext: context ?? {},
          });
        } else {
          console.log(`[FactoryLearning] ✅ Saved correction for factory "${factoryId}", field "${field}"`);
        }
      } catch (err) {
        console.warn('[FactoryLearning] Could not persist correction:', err);
      }
    },
    [factoryId, factoryName],
  );

  /**
   * Apply loaded corrections to a parsed product list.
   * Returns a NEW array — does not mutate input.
   */
  const applyCorrections = useCallback(
    <T extends { modelNumber?: string }>(
      products: T[],
    ): T[] => {
      const patterns = correctionCache.current[factoryId];
      if (!patterns || patterns.length === 0) return products;

      return products.map((product) => {
        const updated = { ...product } as T & Record<string, unknown>;
        for (const pattern of patterns) {
          const field = pattern.fieldName as CorrectableField;
          // Apply only when model matches (if a model was provided) OR globally
          const modelMatches =
            !pattern.modelNumber ||
            pattern.modelNumber === product.modelNumber;
          if (!modelMatches) continue;

          const currentValue = String(updated[field] ?? '');

          // If the current value matches the original bad value → replace
          if (
            pattern.originalValue !== null &&
            currentValue === pattern.originalValue
          ) {
            (updated as any)[field] = pattern.correctedValue;
          }
          // If there's no originalValue it's a "global default" — apply only
          // when the current value is empty / zero
          else if (
            pattern.originalValue === null &&
            (!currentValue || currentValue === '0')
          ) {
            (updated as any)[field] = pattern.correctedValue;
          }
        }
        return updated as T;
      });
    },
    [factoryId],
  );

  /**
   * Get all correction patterns for the current factory (read-only).
   */
  const getCorrections = useCallback((): CorrectionPattern[] => {
    return correctionCache.current[factoryId] ?? [];
  }, [factoryId]);

  return { saveCorrection, applyCorrections, getCorrections };
}

// ─── Helpers ──────────────────────────────────────────────────────

async function loadCorrections(factoryId: string): Promise<CorrectionPattern[]> {
  try {
    const { data, error } = await supabase
      .from('factory_correction_patterns')
      .select('*')
      .eq('factory_id', factoryId)
      .order('occurrence_count', { ascending: false });

    if (error) throw error;

    return (data ?? []).map((row: any) => ({
      id:               row.id,
      factoryId:        row.factory_id,
      factoryName:      row.factory_name,
      fieldName:        row.field_name,
      originalValue:    row.original_value,
      correctedValue:   row.corrected_value,
      modelNumber:      row.model_number,
      correctionContext: row.correction_context ?? {},
      occurrenceCount:  row.occurrence_count ?? 1,
    }));
  } catch (err) {
    console.warn('[FactoryLearning] Failed to load corrections:', err);
    return [];
  }
}

/** Plain upsert fallback (no RPC required) */
async function upsertCorrectionFallback(pattern: CorrectionPattern) {
  const { data: existing, error: fetchErr } = await supabase
    .from('factory_correction_patterns')
    .select('id, occurrence_count')
    .eq('factory_id', pattern.factoryId)
    .eq('field_name', pattern.fieldName)
    .eq('model_number', pattern.modelNumber ?? '')
    .maybeSingle();

  if (fetchErr) {
    console.warn('[FactoryLearning] Fallback fetch error:', fetchErr);
  }

  if (existing?.id) {
    await supabase
      .from('factory_correction_patterns')
      .update({
        corrected_value:  pattern.correctedValue,
        occurrence_count: (existing.occurrence_count ?? 1) + 1,
        correction_context: pattern.correctionContext ?? {},
        updated_at:       new Date().toISOString(),
      })
      .eq('id', existing.id);
  } else {
    await supabase.from('factory_correction_patterns').insert({
      factory_id:         pattern.factoryId,
      factory_name:       pattern.factoryName,
      field_name:         pattern.fieldName,
      original_value:     pattern.originalValue,
      corrected_value:    pattern.correctedValue,
      model_number:       pattern.modelNumber ?? null,
      correction_context: pattern.correctionContext ?? {},
      occurrence_count:   1,
    });
  }
}
