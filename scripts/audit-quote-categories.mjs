// Read-only audit. Never selects product image payloads or changes live data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const env = fs.readFileSync('.env.local', 'utf8');
const token = (process.env.SUPABASE_ACCESS_TOKEN || env.match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m)?.[1] || '').trim().replace(/^['"]|['"]$/g, '');
if (!token) throw new Error('Management credential unavailable');
const sql = `select jsonb_build_object(
 'registry',(select coalesce(jsonb_agg(c),'[]') from (select id,level1,level2 from product_category) c),
 'products',(select coalesce(jsonb_agg(p),'[]') from (select id,title,category,level1_category,level2_category,product_category_id from products) p),
 'items',(select coalesce(jsonb_agg(i),'[]') from (select i.id,i.quote_uuid,q.quote_id,i.name,i.category,i.product_id,i.product_category_id,i.is_section_title,i.is_custom_term from bwf_quote_item i left join bwf_quote q on q.id=i.quote_uuid) i)
) as audit`;
for (const [label, ref] of [['production','riaubhtruisbwdlwjzur'],['develop','omxizeukbcqzsnjsuwod']]) {
 const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});
 if (!r.ok) throw new Error(`${label}: ${await r.text()}`);
 const [{audit:a}] = await r.json();
 const cats = new Map(a.registry.map(c=>[c.id,c]));
 const products = new Map(a.products.map(p=>[p.id,p]));
 const trim = v => String(v ?? '').trim();
 const issues = [];
 const flag = (type, row) => issues.push({type,...row});
 for (const p of a.products) {
  const c=cats.get(p.product_category_id);
  if(p.product_category_id&&!c) flag('product_invalid_category_id',p);
  if(c&&(trim(p.level1_category)!==trim(c.level1)||trim(p.level2_category)!==trim(c.level2))) flag('product_registry_text_mismatch',p);
  if(!p.product_category_id&&(trim(p.category)||trim(p.level1_category)||trim(p.level2_category))) flag('product_text_without_category_id',p);
 }
 const items=a.items.filter(i=>!i.is_section_title&&!i.is_custom_term);
 for(const i of items){
  const c=cats.get(i.product_category_id),p=products.get(i.product_id);
  if(i.product_category_id&&!c) flag('quote_invalid_category_id',i);
  if(!i.product_category_id&&trim(i.category)) flag('quote_hidden_legacy_category',i);
  if(c&&trim(i.category)!==trim(c.level2||c.level1)) flag('quote_pdf_registry_mismatch',{...i,registry:c});
  if(i.product_id&&!p) flag('quote_missing_linked_product',i);
  if(p&&i.product_category_id&&p.product_category_id&&i.product_category_id!==p.product_category_id) flag('quote_product_category_difference',{...i,product:p});
  // Semantic candidates only: names can be custom; these are never auto-corrected.
  const label=[i.category,c?.level1,c?.level2].filter(Boolean).join(' ');
  if(/椅/.test(i.name||'')&&/櫃|柜|吊櫃/.test(label)) flag('quote_chair_named_as_cabinet',i);
  if(/升降[枱桌台]/.test(i.name||'')&&/櫃|柜/.test(label)) flag('quote_lift_desk_named_as_cabinet',i);
  if(/[摺折][枱桌台]/.test(i.name||'')&&/櫃|柜/.test(label)) flag('quote_folding_table_named_as_cabinet',i);
 }
 for(const p of a.products){
  const c=cats.get(p.product_category_id);const label=[p.category,p.level1_category,p.level2_category,c?.level1,c?.level2].filter(Boolean).join(' ');
  if(/椅/.test(p.title||'')&&/櫃|柜/.test(label)) flag('product_chair_named_as_cabinet',p);
  if(/升降[枱桌台]/.test(p.title||'')&&/櫃|柜/.test(label)) flag('product_lift_desk_named_as_cabinet',p);
 }
 const summary={environment:label,products:a.products.length,quoteRows:a.items.length,productQuoteRows:items.length,quotes:new Set(items.map(i=>i.quote_uuid)).size,counts:Object.fromEntries([...new Set(issues.map(i=>i.type))].map(t=>[t,issues.filter(i=>i.type===t).length]))};
 const file=path.join(os.tmpdir(),`fds-category-audit-${label}-20261030.json`);
 fs.writeFileSync(file,JSON.stringify({summary,issues},null,2));
 console.log(JSON.stringify({summary,file,examples:issues.filter(i=>/named_as_cabinet/.test(i.type)).slice(0,15)},null,2));
}
