/**
 * Persist quotation editor state to Supabase (bwf_quote + bwf_quote_item).
 *
 * - save-current: update the open version row, or insert v1 when the chain is new
 * - new-version: always insert the next version on the quote_id chain (版本審核)
 */

import { supabase } from '@/lib/supabase';
import {
  extractPmsPitchingIdFromProjectData,
  extractPmsProjectIdFromProjectData,
} from '@/lib/pmsQuotePrefill';
import { withInsertAuditFields, withUpdateAuditFields } from '@/lib/pmsAudit';
import { quoteItemHasBase64Images } from '@/lib/quoteImageStorage';
import {
  replaceQuoteItems,
  resolveItemImagesToStorage,
  stripItemsFromProjectData,
  resolvePitchingCode,
  type BwfQuoteItemInput,
} from '@/lib/bwfQuoteItems';
import {
  nextQuoteVersionFromChain,
  quoteVersionSequence,
} from '@/lib/quoteVersions';
import {
  resolveQuoteChainId,
  isLegacyQFormatQuoteId,
  pickQuoteChainId,
} from '@/lib/quoteChainId';
import { parseQuotePathname } from '@/lib/quoteRoutes';
import { fetchPmsPitchingQuoteDefaults } from '@/lib/pmsPitchingQuoteDefaults';
import { fetchPmsPitchings } from '@/lib/pmsPitchings';

export type PersistBwfQuoteMode = 'save-current' | 'new-version';

export interface PersistBwfQuoteResult {
  quoteId: string;
  quoteUuid: string;
  version: string;
  projectData: Record<string, unknown>;
  totalAmount: number;
  status: string;
}

export interface PersistBwfQuoteInput {
  mode: PersistBwfQuoteMode;
  totalAmount: number;
  totalCostPrice?: number | null;
  projectData: Record<string, unknown>;
  items?: BwfQuoteItemInput[];
  bwfPitchingId?: string | null;
  bwfProjectId?: string | null;
  quoteId?: string | null;
  pitchingCode?: string | null;
  existingQuoteId?: string | null;
  existingQuoteUuid?: string | null;
  /** Version currently open in the editor (used by save-current). */
  existingVersion?: string | null;
  /** Status to keep on update; new rows default to 待審核. */
  existingStatus?: string | null;
  submitter: string;
  /** Optional locked chain id from modal open. */
  lockedChainId?: string | null;
}

function quotePathChainId(): string {
  if (typeof window === 'undefined') return '';
  const parsed = parseQuotePathname(window.location.pathname);
  return parsed.kind === 'quote' ? parsed.quoteId : '';
}

function hasPersistableItems(items: BwfQuoteItemInput[]): boolean {
  return items.some(
    (item) =>
      !item.isSectionTitle &&
      Boolean(String(item.name || '').trim() || (item.unitPrice ?? 0) > 0),
  );
}

async function resolveQuoteIdAndPitching(
  input: PersistBwfQuoteInput,
): Promise<{ quoteId: string; pitchingId: string | null; projectId: string | null }> {
  let pitchingId =
    input.bwfPitchingId ||
    extractPmsPitchingIdFromProjectData(input.projectData) ||
    null;
  const projectId =
    input.bwfProjectId ||
    extractPmsProjectIdFromProjectData(input.projectData) ||
    null;

  const formDataRaw =
    (input.projectData.formData as Record<string, unknown> | undefined) || {};
  const quoteMeta =
    (input.projectData.quoteMeta as Record<string, unknown> | undefined) || {};

  let code = resolvePitchingCode({
    quoteId: pickQuoteChainId(
      input.lockedChainId,
      input.quoteId,
      input.existingQuoteId,
    ),
    pitchingCode: input.pitchingCode,
    formData: formDataRaw,
    quoteMeta,
  });

  if (isLegacyQFormatQuoteId(code)) {
    code = '';
  }

  if (!code && pitchingId) {
    const defaults = await fetchPmsPitchingQuoteDefaults({
      pitchingId,
      projectId,
    });
    code =
      defaults?.pitching_code?.trim() ||
      defaults?.project_code?.trim() ||
      '';
  }

  const quoteId = resolveQuoteChainId({
    code,
    existingQuoteId: input.existingQuoteId,
    fallbacks: [
      input.lockedChainId,
      input.quoteId,
      input.pitchingCode,
      typeof quoteMeta.quoteNumber === 'string' ? quoteMeta.quoteNumber : null,
      typeof quoteMeta.projectName === 'string' ? quoteMeta.projectName : null,
      quotePathChainId(),
    ],
  });
  if (!quoteId) {
    throw new Error('缺少報價單號（PMS Pitching Code），無法保存');
  }

  if (!pitchingId) {
    const matches = await fetchPmsPitchings({
      codes: [quoteId],
      limit: 5,
    });
    const match = matches.find(
      (row) => row.pitching_code?.trim() === quoteId.trim(),
    );
    if (match?.id) pitchingId = match.id;
  }

  return { quoteId, pitchingId, projectId };
}

function buildPayloadProjectData(
  projectData: Record<string, unknown>,
  pitchingId: string | null,
  projectId: string | null,
): Record<string, unknown> {
  const formDataRaw =
    (projectData.formData as Record<string, unknown> | undefined) || {};
  const {
    quoteId: _dropFormQuoteId,
    pitchingCode: _dropPitchingCode,
    projectName: _dropProjectName,
    pitchingName: _dropPitchingName,
    ...formDataRest
  } = formDataRaw;
  void _dropFormQuoteId;
  void _dropPitchingCode;
  void _dropProjectName;
  void _dropPitchingName;
  const formData = {
    ...formDataRest,
    ...(pitchingId ? { pmsPitchingId: pitchingId } : {}),
    ...(projectId ? { pmsProjectId: projectId } : {}),
  };
  const payloadProjectData = stripItemsFromProjectData({
    ...projectData,
    formData,
  });
  if ('items' in payloadProjectData) {
    delete payloadProjectData.items;
  }
  return payloadProjectData;
}

export async function persistBwfQuote(
  input: PersistBwfQuoteInput,
): Promise<PersistBwfQuoteResult> {
  const embeddedItems = Array.isArray(input.projectData.items)
    ? (input.projectData.items as BwfQuoteItemInput[])
    : [];
  const sourceItems =
    input.items && input.items.length > 0 ? input.items : embeddedItems;

  if (!hasPersistableItems(sourceItems)) {
    throw new Error('沒有可保存的報價品項。請確認內容後再試。');
  }
  if (!(input.totalAmount > 0)) {
    throw new Error('報價總金額為 HK$0，無法保存。');
  }
  if (!input.submitter.trim()) {
    throw new Error('缺少提交者姓名，無法保存。');
  }

  const { quoteId, pitchingId, projectId } = await resolveQuoteIdAndPitching(input);
  const payloadProjectData = buildPayloadProjectData(
    input.projectData,
    pitchingId,
    projectId,
  );
  if ('items' in payloadProjectData) {
    throw new Error('internal: project_data must not contain items');
  }

  const resolvedItems = await resolveItemImagesToStorage(sourceItems, quoteId);
  if (resolvedItems.some((item) => quoteItemHasBase64Images(item))) {
    throw new Error('部分圖片未能上傳至 Storage，請檢查網絡後重試');
  }

  const { data: versionRows, error: versionErr } = await supabase
    .from('bwf_quote')
    .select('id, version, status')
    .eq('quote_id', quoteId);
  if (versionErr) throw versionErr;
  const chain = versionRows || [];

  if (input.mode === 'save-current') {
    const targetUuid = input.existingQuoteUuid?.trim() || '';
    const existingRow = targetUuid
      ? chain.find((row) => String(row.id) === targetUuid)
      : null;

    if (existingRow?.id) {
      const version = String(existingRow.version || input.existingVersion || 'v1');
      const status =
        (input.existingStatus || existingRow.status || '待審核').trim() ||
        '待審核';
      const updatePayload = await withUpdateAuditFields({
        status,
        total_amount: input.totalAmount,
        cost_price: input.totalCostPrice ?? null,
        submitter: input.submitter.trim(),
        project_data: payloadProjectData,
        ...(pitchingId ? { bwf_pitching_id: pitchingId } : {}),
        ...(projectId ? { bwf_project_id: projectId } : {}),
      });
      const { error: updateErr } = await supabase
        .from('bwf_quote')
        .update(updatePayload)
        .eq('id', existingRow.id);
      if (updateErr) throw updateErr;
      await replaceQuoteItems(existingRow.id, resolvedItems);
      return {
        quoteId,
        quoteUuid: existingRow.id,
        version,
        projectData: payloadProjectData,
        totalAmount: input.totalAmount,
        status,
      };
    }

    // Brand-new quote (or draft never persisted): create v1.
    if (chain.length === 0) {
      const resolvedVersion = 'v1';
      const status = '待審核';
      const insertPayload = await withInsertAuditFields({
        quote_id: quoteId,
        version: resolvedVersion,
        status,
        total_amount: input.totalAmount,
        cost_price: input.totalCostPrice ?? null,
        submitter: input.submitter.trim(),
        project_data: payloadProjectData,
        ...(pitchingId ? { bwf_pitching_id: pitchingId } : {}),
        ...(projectId ? { bwf_project_id: projectId } : {}),
      });
      const { data: inserted, error: dbError } = await supabase
        .from('bwf_quote')
        .insert(insertPayload)
        .select('id')
        .single();
      if (dbError) throw dbError;
      if (!inserted?.id) throw new Error('報價單已建立但缺少 id');
      await replaceQuoteItems(inserted.id, resolvedItems);
      return {
        quoteId,
        quoteUuid: inserted.id,
        version: resolvedVersion,
        projectData: payloadProjectData,
        totalAmount: input.totalAmount,
        status,
      };
    }

    // Chain exists but editor lost uuid — update the latest version row.
    const latest = [...chain].sort(
      (a, b) =>
        quoteVersionSequence(String(a.version || '')) -
        quoteVersionSequence(String(b.version || '')),
    )[chain.length - 1];
    if (!latest?.id) {
      throw new Error('找不到可更新的報價版本');
    }
    const version = String(latest.version || 'v1');
    const status =
      (input.existingStatus || latest.status || '待審核').trim() || '待審核';
    const updatePayload = await withUpdateAuditFields({
      status,
      total_amount: input.totalAmount,
      cost_price: input.totalCostPrice ?? null,
      submitter: input.submitter.trim(),
      project_data: payloadProjectData,
      ...(pitchingId ? { bwf_pitching_id: pitchingId } : {}),
      ...(projectId ? { bwf_project_id: projectId } : {}),
    });
    const { error: updateErr } = await supabase
      .from('bwf_quote')
      .update(updatePayload)
      .eq('id', latest.id);
    if (updateErr) throw updateErr;
    await replaceQuoteItems(latest.id, resolvedItems);
    return {
      quoteId,
      quoteUuid: latest.id,
      version,
      projectData: payloadProjectData,
      totalAmount: input.totalAmount,
      status,
    };
  }

  // new-version (版本審核)
  const versionList = chain.map((r) => String(r.version || ''));
  const resolvedVersion =
    versionList.length > 0 ? nextQuoteVersionFromChain(versionList) : 'v1';
  const status = '待審核';
  const insertPayload = await withInsertAuditFields({
    quote_id: quoteId,
    version: resolvedVersion,
    status,
    total_amount: input.totalAmount,
    cost_price: input.totalCostPrice ?? null,
    submitter: input.submitter.trim(),
    project_data: payloadProjectData,
    ...(pitchingId ? { bwf_pitching_id: pitchingId } : {}),
    ...(projectId ? { bwf_project_id: projectId } : {}),
  });
  const { data: inserted, error: dbError } = await supabase
    .from('bwf_quote')
    .insert(insertPayload)
    .select('id')
    .single();
  if (dbError) throw dbError;
  if (!inserted?.id) throw new Error('報價單已建立但缺少 id');
  await replaceQuoteItems(inserted.id, resolvedItems);
  return {
    quoteId,
    quoteUuid: inserted.id,
    version: resolvedVersion,
    projectData: payloadProjectData,
    totalAmount: input.totalAmount,
    status,
  };
}
