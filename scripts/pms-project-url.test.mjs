import assert from 'node:assert/strict';
import {
  FURNITURE_PRODUCTION_REF,
  PMS_DEV_URL,
  PMS_PRODUCTION_URL,
  resolvePmsProjectUrl,
  selectPmsServiceRoleKey,
} from '../supabase/functions/_shared/pmsProject.ts';

function jwt(ref) {
  const payload = Buffer.from(JSON.stringify({ ref, role: 'service_role' })).toString('base64url');
  return `e30.${payload}.sig`;
}

const prodFurniture = `https://${FURNITURE_PRODUCTION_REF}.supabase.co`;
const branchFurniture = 'https://omxizeukbcqzsnjsuwod.supabase.co';
const prodKey = jwt('kqwktnplkqucsbasyfjl');
const devKey = jwt('alrbbyqkeobmvvvscpma');

assert.equal(
  resolvePmsProjectUrl({ supabaseUrl: prodFurniture }),
  PMS_PRODUCTION_URL,
);
assert.equal(
  resolvePmsProjectUrl({ supabaseUrl: branchFurniture }),
  PMS_DEV_URL,
);
assert.equal(
  resolvePmsProjectUrl({
    supabaseUrl: branchFurniture,
    masterSupabaseUrl: 'https://example.supabase.co',
  }),
  'https://example.supabase.co',
);
assert.equal(
  selectPmsServiceRoleKey(PMS_DEV_URL, [prodKey, devKey]),
  devKey,
);
assert.equal(selectPmsServiceRoleKey(PMS_DEV_URL, [prodKey]), '');
assert.equal(selectPmsServiceRoleKey(PMS_PRODUCTION_URL, [prodKey]), prodKey);

console.log('pms project url tests passed');
