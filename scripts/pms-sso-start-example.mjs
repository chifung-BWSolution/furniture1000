#!/usr/bin/env node
/**
 * Reference: PMS3.0 API route handler for SSO start.
 *
 * Flow:
 *   1. User hits GET /bwf/sso/start on PMS (must have valid PMS Supabase session)
 *   2. PMS page verifies session, invokes supabase-functions-bwf-sso-start
 *   3. Edge function syncs user + mints Furniture SSO code
 *   4. Browser redirects to exchange_url → Furniture /auth/pms/callback?code=...
 *
 * Env (PMS server):
 *   BWF_SUPABASE_URL=https://riaubhtruisbwdlwjzur.supabase.co
 *   PMS_SSO_SHARED_SECRET=<same as Furniture edge function secret>
 *
 * Next.js App Router example (app/api/bwf/sso/start/route.ts):
 *
 *   import { createServerClient } from '@supabase/ssr';
 *   import { cookies } from 'next/headers';
 *   import { NextResponse } from 'next/server';
 *
 *   export async function GET() {
 *     const cookieStore = await cookies();
 *     const supabase = createServerClient(
 *       process.env.NEXT_PUBLIC_SUPABASE_URL!,
 *       process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
 *       { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
 *     );
 *     const { data: { user } } = await supabase.auth.getUser();
 *     if (!user?.email) {
 *       const login = new URL('/login', process.env.NEXT_PUBLIC_APP_URL);
 *       login.searchParams.set('return_to', '/api/bwf/sso/start');
 *       return NextResponse.redirect(login);
 *     }
 *
 *     const res = await fetch(
 *       `${process.env.BWF_SUPABASE_URL}/functions/v1/supabase-functions-pms-sso`,
 *       {
 *         method: 'POST',
 *         headers: {
 *           'Content-Type': 'application/json',
 *           'x-pms-sso-secret': process.env.PMS_SSO_SHARED_SECRET!,
 *         },
 *         body: JSON.stringify({
 *           action: 'mint',
 *           user_id: user.id,
 *           email: user.email,
 *           redirect_to: `${process.env.FURNITURE_APP_URL}/auth/pms/callback`,
 *         }),
 *       },
 *     );
 *     const data = await res.json();
 *     if (!res.ok) return NextResponse.json(data, { status: res.status });
 *     return NextResponse.redirect(data.exchange_url);
 *   }
 *
 * Set VITE_PMS_SSO_START_URL (Furniture) to the full PMS start URL above.
 */

const BWF_URL = process.env.BWF_SUPABASE_URL || 'https://riaubhtruisbwdlwjzur.supabase.co';
const SECRET = process.env.PMS_SSO_SHARED_SECRET;
const FURNITURE_APP = process.env.FURNITURE_APP_URL || 'https://www.bwteam-furniture.com';

async function mintCode(userId, email) {
  if (!SECRET) throw new Error('PMS_SSO_SHARED_SECRET is required');

  const res = await fetch(`${BWF_URL}/functions/v1/supabase-functions-pms-sso`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-pms-sso-secret': SECRET,
    },
    body: JSON.stringify({
      action: 'mint',
      user_id: userId,
      email,
      redirect_to: `${FURNITURE_APP.replace(/\/+$/, '')}/auth/pms/callback`,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `mint failed (${res.status})`);
  }
  return data;
}

if (process.argv[2] === '--dry-run') {
  console.log('PMS SSO mint endpoint:', `${BWF_URL}/functions/v1/supabase-functions-pms-sso`);
  console.log('Furniture callback:', `${FURNITURE_APP}/auth/pms/callback`);
  console.log('Set VITE_PMS_SSO_START_URL to https://bwteam-marketing.com/bwf/sso/start');
  process.exit(0);
}

const userId = process.argv[2];
const email = process.argv[3];
if (!userId || !email) {
  console.error('Usage: node scripts/pms-sso-start-example.mjs <user_id> <email>');
  console.error('       node scripts/pms-sso-start-example.mjs --dry-run');
  process.exit(1);
}

mintCode(userId, email)
  .then((data) => {
    console.log(JSON.stringify(data, null, 2));
    console.log('\nOpen in browser:', data.exchange_url);
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
