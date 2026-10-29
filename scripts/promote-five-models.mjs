import fs from 'node:fs';
import crypto from 'node:crypto';
const env=fs.readFileSync('.env.local','utf8');
const token=(process.env.SUPABASE_ACCESS_TOKEN||env.match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m)?.[1]||'').trim().replace(/^['"]|['"]$/g,'');
const dev='omxizeukbcqzsnjsuwod',prod='riaubhtruisbwdlwjzur';
const q=s=>"'"+String(s).replaceAll("'","''")+"'";
async function api(ref,route,body){const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error(`${route}: ${r.status} ${await r.text()}`);return r.json();}
const sql=(ref,query)=>api(ref,'database/query',{query});
const products=await sql(dev,"select p.id,p.model,p.sku from public.products p where exists(select 1 from public.product_models m where m.product_id=p.id) order by p.model");
console.log('available',products);
const selected=products.filter(p=>['7ay39iwj03l','elvqr15yk7r','4pteejgt544','rh5e0e0ytlc','06susjkpjr3f'].includes(p.id));
if(selected.length!==5)throw Error('Expected exactly five screenshot products; inspect available models');
const ids=selected.map(p=>q(p.id)).join(',');
const target=await sql(prod,`select id,model,sku from public.products where id in (${ids})`);
if(target.length!==5||selected.some(p=>!target.some(t=>t.id===p.id&&t.model===p.model&&t.sku===p.sku)))throw Error('Production identity mismatch');
const rows=await sql(dev,`select * from public.product_models where product_id in (${ids})`);
const old=await sql(prod,`select * from public.product_models where product_id in (${ids})`);
const dir=`D:/work/fds-model-promotion-${Date.now()}`;fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(`${dir}/backup.json`,JSON.stringify({selected,old,source:rows},null,2));
if(!process.argv.includes('--apply')){console.log('PREVIEW',selected,'rows',rows.length,'old',old.length,'backup',dir);process.exit(0);}
const keys={};for(const ref of [dev,prod]){keys[ref]=(await api(ref,'api-keys')).find(k=>k.name==='service_role')?.api_key;if(!keys[ref])throw Error('key unavailable');}
const paths=new Set(rows.flatMap(r=>[r.storage_path,r.preview_storage_path,r.bundle_storage_path]).filter(Boolean));
for(const p of [...paths]){if(p.endsWith('.fbx')){const prefix=p.slice(0,p.lastIndexOf('/')+1);const files=await sql(dev,`select name from storage.objects where bucket_id='product-models' and starts_with(name,${q(prefix)})`);for(const f of files)paths.add(f.name);}}
const mapping=new Map();const prefix=`promoted/${Date.now()}/`;
for(const p of paths){const source=await fetch(`https://${dev}.supabase.co/storage/v1/object/product-models/${p}`,{headers:{Authorization:`Bearer ${keys[dev]}`}});if(!source.ok)throw Error(`source missing ${p}`);const bytes=Buffer.from(await source.arrayBuffer());const dest=prefix+p;const url=`https://${prod}.supabase.co/storage/v1/object/product-models/${dest}`;const upload=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${keys[prod]}`,apikey:keys[prod],'Content-Type':source.headers.get('content-type')||'application/octet-stream'},body:bytes});if(!upload.ok)throw Error(`upload ${await upload.text()}`);const verify=await fetch(url,{headers:{Authorization:`Bearer ${keys[prod]}`}});const hash=b=>crypto.createHash('sha256').update(b).digest('hex');if(!verify.ok||hash(Buffer.from(await verify.arrayBuffer()))!==hash(bytes))throw Error('hash mismatch');mapping.set(p,dest);}
const columns=(await sql(prod,"select column_name from information_schema.columns where table_schema='public' and table_name='product_models'")).map(c=>c.column_name);
const excluded=['id','created_by','generation_job_id','generation_mode','furniture_model_id'];
const cols=Object.keys(rows[0]).filter(c=>columns.includes(c)&&!excluded.includes(c));
const values=rows.map(r=>'('+cols.map(c=>{let v=r[c];if(['storage_path','preview_storage_path','bundle_storage_path'].includes(c)&&v)v=mapping.get(v);return v==null?'null':q(typeof v==='object'?JSON.stringify(v):v);}).join(',')+')').join(',');
await sql(prod,`begin; insert into public.product_models(${cols.join(',')}) values ${values}; delete from public.product_models where id in (${old.map(r=>q(r.id)).join(',')||'null'}); commit;`);
const final=await sql(prod,`select product_id,format,file_name,storage_path from public.product_models where product_id in (${ids}) order by product_id,format`);
fs.writeFileSync(`${dir}/receipt.json`,JSON.stringify({final,mapping:[...mapping]},null,2));
console.log('PROMOTED',final,'backup',dir);
