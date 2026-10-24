// LF-H32P controlled trial, FDS preview only. No automatic provider fallback/retry.
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const ref = 'omxizeukbcqzsnjsuwod';
const modelDeploy = process.argv.includes('--model-analysis');
const slug = modelDeploy ? 'supabase-functions-generate-furniture-model' : 'supabase-functions-generate-quote-reference-image';
const output = 'output/three-view-trial/auto-analysis';
const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)
  .filter(s => /^[A-Z_]+=/.test(s)).map(s => {
    const i = s.indexOf('=');
    return [s.slice(0, i), s.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
  }));
const token = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN;
if (!token) throw new Error('Management token required');
async function management(path, init = {}) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers }, signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Management ${path}: HTTP ${response.status}`);
  return response;
}
fs.mkdirSync(output, { recursive: true });
if (process.argv.includes('--hide-trials')) {
  const keys = await (await management('api-keys')).json();
  const anonKey = keys.find(k => k.name === 'anon')?.api_key;
  const db = createClient(`https://${ref}.supabase.co`, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const login = await db.auth.signInWithPassword({ email: env.VITE_QUICK_LOGIN_EMAIL, password: env.VITE_QUICK_LOGIN_PASSWORD });
  if (login.error) throw new Error('Preview login failed');
  for (const provider of ['grok', 'gemini']) {
    const file = `${output}/${provider}-result.json`;
    if (!fs.existsSync(file)) continue;
    const id = JSON.parse(fs.readFileSync(file, 'utf8')).result?.asset?.id;
    if (!id) continue;
    const result = await db.from('quote_photo_assets').update({ is_active: false }).eq('id', id).select('id,is_active').single();
    if (result.error || result.data?.is_active !== false) throw new Error('Failed to hide trial asset');
    console.log(JSON.stringify({ provider, assetId: id, isActive: result.data.is_active }));
  }
  await db.auth.signOut();
} else if (process.argv.includes('--deploy')) {
  const form = new FormData();
  form.set('metadata', new Blob([JSON.stringify({ name: slug, entrypoint_path: 'index.ts', verify_jwt: false })], { type: 'application/json' }), 'metadata.json');
  form.append('file', new Blob([fs.readFileSync(`supabase/functions/${modelDeploy ? 'generate-furniture-model' : 'generate-quote-reference-image'}/index.ts`)], { type: 'application/typescript' }), 'index.ts');
  const deployed = await (await management(`functions/deploy?slug=${slug}`, { method: 'POST', body: form })).json();
  const readback = await (await management(`functions/${slug}/body`)).text();
  if (modelDeploy ? !readback.includes('inferred_reference') : (!readback.includes('analyzeDrawing') || !readback.includes('product_description'))) throw new Error('Deployment read-back missing drawing analysis');
  console.log(JSON.stringify({ ref, slug, version: deployed.version, readback: true }));
} else if (process.argv.includes('--generate')) {
  const provider = process.argv.includes('--gemini') ? 'gemini' : 'grok';
  const recordPath = `${output}/${provider}-result.json`;
  if (fs.existsSync(recordPath)) throw new Error('Result already recorded; inspect it instead of paying again');
  const keys = await (await management('api-keys')).json();
  const anonKey = keys.find(k => k.name === 'anon')?.api_key;
  if (!anonKey) throw new Error('Preview anon key unavailable');
  const base = `https://${ref}.supabase.co`;
  const db = createClient(base, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const login = await db.auth.signInWithPassword({ email: env.VITE_QUICK_LOGIN_EMAIL, password: env.VITE_QUICK_LOGIN_PASSWORD });
  if (login.error || !login.data.session) throw new Error(`Preview login failed: ${login.error?.message}`);
  const role = await db.rpc('bwf_has_role', { p_roles: ['admin', 'uploader'] });
  if (role.data !== true) throw new Error('Current preview actor cannot generate images');
  console.log(JSON.stringify({ ref, actor: login.data.user.id, provider }));
  const sourcePaths = JSON.parse(fs.readFileSync(`${output}/sources.json`, 'utf8'));
  if (!Array.isArray(sourcePaths) || sourcePaths.length < 2 || sourcePaths.length > 3 || new Set(sourcePaths).size !== sourcePaths.length) throw new Error('Select 2 to 3 distinct, inspected product images');
  const referencePaths = [];
  const hashes = new Set();
  for (const sourcePath of sourcePaths) {
    const bytes = fs.readFileSync(sourcePath);
    const hash = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
    if (hashes.has(hash)) throw new Error('Duplicate image content');
    hashes.add(hash);
    const path = `orthographic-trials/${login.data.user.id}/${crypto.randomUUID()}.jpg`;
    const upload = await db.storage.from('product-images').upload(path, bytes, { contentType: 'image/jpeg' });
    if (upload.error) throw new Error(`Reference upload failed: ${upload.error.message}`);
    referencePaths.push(path);
  }
  // Product-specific structure/material instructions are generated by server-side vision analysis.
  const productId = '7ay39iwj03l';
  // Persist intent before the paid request. An unknown outcome must be checked manually.
  fs.writeFileSync(recordPath, JSON.stringify({ ref, provider, productId, sourcePaths, referencePaths, status: 'submission_started', startedAt: new Date().toISOString() }, null, 2));
  const response = await fetch(`${base}/functions/v1/${slug}`, {
    method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${login.data.session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: provider, purpose: 'orthographic', productId, aspectRatio: '4:3', referenceUrls: referencePaths.map(path => `${base}/storage/v1/object/public/product-images/${path}`) }),
    signal: AbortSignal.timeout(260_000),
  });
  const result = await response.json();
  fs.writeFileSync(recordPath, JSON.stringify({ ref, provider, productId, sourcePaths, referencePaths, httpStatus: response.status, result }, null, 2));
  console.log(JSON.stringify({ status: response.status, modelId: result.modelId, asset: result.asset?.url, error: result.error }));
  if (!response.ok || !result.asset?.url) process.exitCode = 1;
  else {
    const image = await fetch(result.asset.url);
    if (!image.ok) throw new Error(`Generated asset read-back: HTTP ${image.status}`);
    const ext = result.asset.objectPath.split('.').pop();
    fs.writeFileSync(`${output}/${provider}-three-view.${ext}`, Buffer.from(await image.arrayBuffer()));
  }
  await db.auth.signOut();
} else throw new Error('Choose --deploy, --generate [--gemini], or --hide-trials');
