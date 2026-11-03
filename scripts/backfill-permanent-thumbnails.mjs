import fs from 'node:fs';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
const ref = process.argv.find(a => a.startsWith('--ref='))?.slice(6);
if (!['omxizeukbcqzsnjsuwod', 'riaubhtruisbwdlwjzur'].includes(ref)) throw new Error('Specify --ref=<FDS2.0 or BWF project ref>');
const apply = process.argv.includes('--apply');
const limit = Number(process.argv.find(a => a.startsWith('--limit='))?.slice(8) || '100000');
if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid limit');
const env = fs.readFileSync('.env.local', 'utf8');
const token = process.env.SUPABASE_ACCESS_TOKEN || env.match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
async function api(path, body) {
  const r = await fetch('https://api.supabase.com/v1/' + path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!r.ok) throw new Error(`Management API ${r.status}`);
  return r.json();
}
const query = `select o.name from storage.objects o where o.bucket_id='product-images' and o.name !~ '^(__thumbs/|catalog-thumbs/)' and lower(o.name) ~ '\\.(jpg|jpeg|png|webp)$' and not exists (select 1 from storage.objects t where t.bucket_id=o.bucket_id and t.name='__thumbs/v1/'||o.name||'.webp') order by o.name limit ${limit}`;
const rows = await api(`projects/${ref}/database/query`, {query, read_only:true});
console.log(JSON.stringify({ref, apply, missing:rows.length}));
if (apply) {
  const keys = await api(`projects/${ref}/api-keys`);
  const key = keys.find(k => k.name === 'service_role')?.api_key;
  if (!key) throw new Error('Service role unavailable');
  const client = createClient(`https://${ref}.supabase.co`, key, {auth:{persistSession:false, autoRefreshToken:false}});
  let written=0, failed=0;
  for (const {name} of rows) {
    try {
      const {data, error} = await client.storage.from('product-images').download(name);
      if (error) throw error;
      const bytes = await sharp(Buffer.from(await data.arrayBuffer()), {limitInputPixels: 80000000}).rotate().resize({width:640,height:640,fit:'inside',withoutEnlargement:true}).webp({quality:65}).toBuffer();
      const result=await client.storage.from('product-images').upload(`__thumbs/v1/${name}.webp`,bytes,{contentType:'image/webp',cacheControl:'31536000',upsert:false});
      if(result.error && !['409','Duplicate'].includes(String(result.error.statusCode ?? result.error.error))) throw result.error;
      written++;
    } catch (error) { failed++; console.error(JSON.stringify({name,error:error.message})); }
    if ((written+failed)%100===0) console.log(JSON.stringify({written,failed}));
  }
  console.log(JSON.stringify({written,failed}));
  if(failed) process.exitCode=1;
}
