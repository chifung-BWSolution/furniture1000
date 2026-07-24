/**
 * Client portal feedback appended under design-project product notes.
 * Staff-editable notes stay above the marker; feedback lines are JSON.
 */
import type { ZoneProductStatus } from '@/types/solutions';

export type ClientItemReview = 'accepted' | 'change' | 'rejected';

export type ZoneProductClientFeedback = {
  at: string;
  review: ClientItemReview;
  text: string;
  author: string;
};

export const CLIENT_FEEDBACK_MARKER = '---CLIENT_FEEDBACK_V1---';

export const REVIEW_TO_ZONE_STATUS: Record<ClientItemReview, ZoneProductStatus> =
  {
    accepted: 'confirmed',
    change: 'discussing',
    rejected: 'pending',
  };

/** Only map statuses that imply a client decision already made. */
export const ZONE_STATUS_TO_REVIEW: Partial<
  Record<ZoneProductStatus, ClientItemReview>
> = {
  confirmed: 'accepted',
  discussing: 'change',
  // pending / 未確定 = default before client acts — do not treat as「不接受」
};

export function splitStaffNotesAndFeedback(notes: string | null | undefined): {
  staffNotes: string;
  feedback: ZoneProductClientFeedback[];
} {
  const raw = notes || '';
  const markerAt = raw.indexOf(CLIENT_FEEDBACK_MARKER);
  if (markerAt < 0) {
    return { staffNotes: raw, feedback: [] };
  }
  const staffNotes = raw.slice(0, markerAt).replace(/\s+$/, '');
  const feedback = raw
    .slice(markerAt + CLIENT_FEEDBACK_MARKER.length)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        const parsed = JSON.parse(line) as ZoneProductClientFeedback;
        if (!parsed || typeof parsed !== 'object') return null;
        if (!parsed.at || !parsed.review) return null;
        return {
          at: String(parsed.at),
          review: parsed.review,
          text: String(parsed.text || ''),
          author: String(parsed.author || '客戶'),
        } satisfies ZoneProductClientFeedback;
      } catch {
        return null;
      }
    })
    .filter((row): row is ZoneProductClientFeedback => Boolean(row));
  return { staffNotes, feedback };
}

export function appendClientFeedbackToNotes(
  notes: string | null | undefined,
  feedback: ZoneProductClientFeedback,
): string {
  const { staffNotes, feedback: existing } = splitStaffNotesAndFeedback(notes);
  const next = [...existing, feedback];
  return serializeStaffNotesAndFeedback(staffNotes, next);
}

export function removeClientFeedbackFromNotes(
  notes: string | null | undefined,
  feedbackIndex: number,
): string {
  const { staffNotes, feedback } = splitStaffNotesAndFeedback(notes);
  if (feedbackIndex < 0 || feedbackIndex >= feedback.length) {
    return notes || '';
  }
  const next = feedback.filter((_, index) => index !== feedbackIndex);
  return serializeStaffNotesAndFeedback(staffNotes, next);
}

export function serializeStaffNotesAndFeedback(
  staffNotes: string,
  feedback: ZoneProductClientFeedback[],
): string {
  const staff = (staffNotes || '').replace(/\s+$/, '');
  if (feedback.length === 0) return staff;
  const body = feedback.map((row) => JSON.stringify(row)).join('\n');
  if (!staff.trim()) return `${CLIENT_FEEDBACK_MARKER}\n${body}`;
  return `${staff}\n\n${CLIENT_FEEDBACK_MARKER}\n${body}`;
}

export function reviewLabelZh(review: ClientItemReview): string {
  if (review === 'accepted') return '接受';
  if (review === 'change') return '要求修改';
  return '不接受';
}

/** Company quotes kept on Client Portal「報價方案」. */
export const PORTAL_ALLOWED_QUOTE_IDS = new Set([
  'BWF-OB26-100', // Inhesion (Asia) Limited
  'BWF-OB26-101', // 長江印務出版資源有限公司
  'BWF-SH26-061', // HK PolyU / Charlene Zhou design project link
  // Note: do NOT include BWF-SH26-058 — that quote_id is another school in bwf_quote.
]);

export const PORTAL_ALLOWED_CLIENT_TERMS = [
  '仁濟醫院',
  'hk polyu charlene zhou',
  '長江印務出版資源有限公司',
  'inhesion (asia) limited',
  'inhesion',
  '比亞廸',
  '比亞迪',
  'byd',
];

export function isAllowedPortalQuote(input: {
  quoteId?: string | null;
  displayName?: string | null;
  clientName?: string | null;
}): boolean {
  const quoteId = String(input.quoteId || '').trim().toUpperCase();
  if (quoteId && PORTAL_ALLOWED_QUOTE_IDS.has(quoteId)) return true;
  const haystack = `${input.displayName || ''} ${input.clientName || ''}`
    .trim()
    .toLowerCase();
  if (!haystack) return false;
  return PORTAL_ALLOWED_CLIENT_TERMS.some((term) => haystack.includes(term));
}
