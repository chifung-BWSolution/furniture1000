/**
 * One-shot: fill project_data.clientInfo.contactName (+ formData.clientContactName)
 * from PMS customers.customer_name via bwf_quote.bwf_pitching_id.
 *
 * Usage:
 *   node scripts/backfill-quote-client-contact.mjs
 *   node scripts/backfill-quote-client-contact.mjs --dry-run
 */
import { createClient } from '@supabase/supabase-js';

const DRY_RUN = process.argv.includes('--dry-run');
// NEXT_PUBLIC_SUPABASE_URL is deliberately NOT in this chain: in every other repo
// that name points at a different Supabase project, so falling back to it here
// would aim a Furniture service_role write at the wrong database.
const FURNITURE_URL =
  process.env.BWF_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  '';
const FURNITURE_KEY =
  process.env.FURNITURE_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.BWF_SUPABASE_SERVICE_KEY ||
  '';
const PMS_URL =
  process.env.MASTER_SUPABASE_URL ||
  'https://kqwktnplkqucsbasyfjl.supabase.co';
const PMS_KEY =
  process.env.PMS_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.MASTER_SERVICE_ROLE_KEY ||
  process.env.FACTORY_SERVICE_ROLE_KEY ||
  '';

if (!FURNITURE_URL || !FURNITURE_KEY) {
  console.error('Missing Furniture Supabase URL / service role key');
  process.exit(1);
}
if (!PMS_KEY) {
  console.error('Missing PMS service role key');
  process.exit(1);
}

const furniture = createClient(FURNITURE_URL, FURNITURE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const pms = createClient(PMS_URL, PMS_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function contactMissing(projectData) {
  if (!projectData || typeof projectData !== 'object') return true;
  const fromInfo = String(projectData.clientInfo?.contactName || '').trim();
  const fromForm = String(projectData.formData?.clientContactName || '').trim();
  return !fromInfo && !fromForm;
}

async function main() {
  console.log(DRY_RUN ? '[dry-run] scanning quotes…' : 'scanning quotes…');

  const { data: quotes, error } = await furniture
    .from('bwf_quote')
    .select('id, quote_id, version, bwf_pitching_id, project_data')
    .not('bwf_pitching_id', 'is', null)
    .order('created_at', { ascending: true });

  if (error) throw error;

  const candidates = (quotes || []).filter((q) =>
    contactMissing(q.project_data),
  );
  console.log(
    `quotes with pitching_id: ${(quotes || []).length}; missing contact: ${candidates.length}`,
  );

  const pitchingIds = [
    ...new Set(
      candidates
        .map((q) => q.bwf_pitching_id)
        .filter((id) => typeof id === 'string' && id),
    ),
  ];

  const contactByPitching = new Map();
  const chunkSize = 80;
  for (let i = 0; i < pitchingIds.length; i += chunkSize) {
    const chunk = pitchingIds.slice(i, i + chunkSize);
    const { data: pitchings, error: pErr } = await pms
      .from('bwf_pitchings')
      .select('id, customer_id')
      .in('id', chunk);
    if (pErr) throw pErr;

    const customerIds = [
      ...new Set(
        (pitchings || [])
          .map((p) => p.customer_id)
          .filter((id) => typeof id === 'string' && id),
      ),
    ];
    const nameByCustomer = new Map();
    if (customerIds.length > 0) {
      const { data: customers, error: cErr } = await pms
        .from('customers')
        .select('id, customer_name')
        .in('id', customerIds);
      if (cErr) throw cErr;
      for (const c of customers || []) {
        const name = String(c.customer_name || '').trim();
        if (c.id && name) nameByCustomer.set(c.id, name);
      }
    }

    for (const p of pitchings || []) {
      const name = nameByCustomer.get(p.customer_id) || '';
      if (p.id && name) contactByPitching.set(p.id, name);
    }
  }

  let updated = 0;
  let skippedNoName = 0;
  let failed = 0;

  for (const q of candidates) {
    const contact = contactByPitching.get(q.bwf_pitching_id) || '';
    if (!contact) {
      skippedNoName += 1;
      continue;
    }

    const prev =
      q.project_data && typeof q.project_data === 'object' ? q.project_data : {};
    const prevClient =
      prev.clientInfo && typeof prev.clientInfo === 'object'
        ? prev.clientInfo
        : {};
    const prevForm =
      prev.formData && typeof prev.formData === 'object' ? prev.formData : {};

    const next = {
      ...prev,
      clientInfo: {
        ...prevClient,
        contactName: contact,
      },
      formData: {
        ...prevForm,
        clientContactName: contact,
      },
    };

    if (DRY_RUN) {
      console.log(
        `[dry-run] ${q.quote_id} ${q.version} → contact="${contact}"`,
      );
      updated += 1;
      continue;
    }

    const { error: uErr } = await furniture
      .from('bwf_quote')
      .update({ project_data: next })
      .eq('id', q.id);

    if (uErr) {
      console.warn(`fail ${q.id}:`, uErr.message);
      failed += 1;
    } else {
      updated += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun: DRY_RUN,
        updated,
        skippedNoName,
        failed,
        pitchingLookups: contactByPitching.size,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
