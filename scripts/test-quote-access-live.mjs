// Transactional permission regression test. All DDL and fixtures are rolled back.
// Explicit target is required; never defaults to Production.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

const ref = process.argv.find(a => a.startsWith('--ref='))?.slice(6);
if (!ref) throw new Error('Pass --ref=<project-ref>');
const token = process.env.SUPABASE_ACCESS_TOKEN || fs.readFileSync('.env.local', 'utf8').match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m)?.[1]?.trim();
if (!token) throw new Error('SUPABASE_ACCESS_TOKEN required');
const migration = fs.readFileSync('supabase/migrations/20261024130000_fds21_quote_access_reconcile.sql', 'utf8');
const own = randomUUID(), other = randomUUID(), actor = randomUUID();
const email = `quote-access-${actor}@example.invalid`;
const share = `qa_${actor.replaceAll('-', '')}`;
const claims = role => `select set_config('request.jwt.claims', '${JSON.stringify({ sub: actor, role, email })}', true);`;
const assert = (condition, message) => `do $$ begin if (${condition}) is not true then raise exception '${message}'; end if; end $$;`;
const denied = statement => `do $$ begin begin ${statement}; raise exception 'Expected permission denial'; exception when insufficient_privilege then null; end; end $$;`;
const query = `begin;
${process.argv.includes('--installed') ? '' : migration}
insert into public.platform_user_profiles(email, role, active) values ('${email}', 'pm', true);
insert into public.bwf_quote(id, quote_id, submitter, project_data, cost_price) values
('${own}', 'QA-${own}', 'permission-test', '{"formData":{"clientEmail":"${email}"}}', 999),
('${other}', 'QA-${other}', 'permission-test', '{}', 888);
insert into public.bwf_quote_share_links(quote_uuid, quote_id, share_token) values ('${own}', 'QA-${own}', '${share}');
${claims('authenticated')}
set local role authenticated;
${assert(`public.bwf_has_role(array['pm'])`, 'PM role missing')}
${assert(`(select count(*) = 2 from public.bwf_quote where id in ('${own}', '${other}'))`, 'PM cannot read quotes')}
select public.save_bwf_quote_items('${own}', '[{"client_item_id":"qa-line","name":"QA","quantity":1,"unit_price":10}]');
update public.bwf_quote set total_amount = 10 where id = '${own}';
${assert(`(select total_amount = 10 from public.bwf_quote where id = '${own}')`, 'PM cannot update quote')}
${assert(`(select count(*) = 1 from public.bwf_quote_item where quote_uuid = '${own}')`, 'PM item writer failed')}
${assert(`(select count(*) = 1 from public.bwf_quote_share_links where share_token = '${share}')`, 'PM cannot read shares')}
insert into public.bwf_quote(quote_id, submitter) values ('QA-PM-${actor}', 'permission-test');
${assert(`(select count(*) = 1 from public.bwf_quote where quote_id = 'QA-PM-${actor}')`, 'PM cannot create quote')}
delete from public.bwf_quote where quote_id = 'QA-PM-${actor}';
${assert(`(select count(*) = 0 from public.bwf_quote where quote_id = 'QA-PM-${actor}')`, 'PM cannot delete quote')}
update public.bwf_quote_share_links set status = 'revoked' where share_token = '${share}';
${assert(`(select status = 'revoked' from public.bwf_quote_share_links where share_token = '${share}')`, 'PM cannot manage shares')}
update public.bwf_quote_share_links set status = 'active' where share_token = '${share}';
reset role;
update public.platform_user_profiles set role = 'admin' where email = '${email}';
set local role authenticated;
${assert(`(select count(*) = 2 from public.bwf_quote where id in ('${own}', '${other}'))`, 'Admin access regression')}
reset role;
update public.platform_user_profiles set role = 'uploader' where email = '${email}';
set local role authenticated;
${assert(`(select count(*) = 2 from public.bwf_quote where id in ('${own}', '${other}'))`, 'Uploader access regression')}
reset role;
update public.platform_user_profiles set role = 'client' where email = '${email}';
set local role authenticated;
${assert(`(select count(*) = 0 from public.bwf_quote where id in ('${own}', '${other}'))`, 'Client direct quote leak')}
${assert(`(select count(*) = 0 from public.bwf_quote_item where quote_uuid = '${own}')`, 'Client direct item leak')}
${assert(`(select count(*) = 0 from public.bwf_quote_share_links where share_token = '${share}')`, 'Client share token leak')}
${assert(`public.get_customer_quote('${own}')->>'id' = '${own}'`, 'Own quote inaccessible')}
${assert(`not (public.get_customer_quote('${own}') ? 'cost_price')`, 'Cost leaked')}
${assert(`public.list_customer_quotes() @> '[{"id":"${own}"}]'::jsonb and not (public.list_customer_quotes() @> '[{"id":"${other}"}]'::jsonb)`, 'Customer list ownership failed')}
${denied(`perform public.get_customer_quote('${other}')`)}
${denied(`perform public.save_customer_quote_scheme(null, '${other}', '[]')`)}
${denied(`perform public.save_bwf_quote_items('${own}', '[]')`)}
select public.save_customer_quote_scheme(null, '${own}', '[{"id":"qa-line","quantity":2,"selected":true}]');
${assert(`(public.get_customer_quote('${own}')->>'total_amount')::numeric = 20`, 'Own scheme save failed')}
reset role;
update public.platform_user_profiles set role = 'designer' where email = '${email}';
set local role authenticated;
${assert(`public.get_customer_quote('${own}')->>'id' = '${own}'`, 'Designer own quote inaccessible')}
${denied(`perform public.get_customer_quote('${other}')`)}
${assert(`(select count(*) = 0 from public.bwf_quote where id = '${own}')`, 'Designer direct quote leak')}
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
${denied('perform 1 from public.bwf_quote limit 1')}
${denied('perform 1 from public.bwf_quote_item limit 1')}
${denied('perform 1 from public.bwf_quote_share_links limit 1')}
${denied('perform public.list_customer_quotes()')}
${denied(`perform public.bwf_customer_quote_json('${own}')`)}
${assert(`public.get_shared_quote('invalid_qa_token') = 'null'::jsonb`, 'Invalid share accepted')}
${assert(`public.get_shared_quote('${share}')->>'id' = '${own}'`, 'Valid share rejected')}
${denied(`perform public.save_customer_quote_scheme('${share}', '${other}', '[]')`)}
select public.save_customer_quote_scheme('${share}', '${own}', '[{"id":"qa-line","quantity":3,"selected":true}]');
${assert(`(public.get_shared_quote('${share}')->>'total_amount')::numeric = 30`, 'Shared scheme save failed')}
reset role;
update public.bwf_quote_share_links set status = 'revoked' where share_token = '${share}';
set local role anon;
${assert(`public.get_shared_quote('${share}') = 'null'::jsonb`, 'Revoked share accepted')}
reset role;
rollback;
`;
const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query }),
});
const result = await response.text();
if (!response.ok) throw new Error(`${response.status}: ${result}`);
console.log(`PASS ${ref}: PM write, client/designer ownership, cost filtering, anonymous isolation, share save/revocation; all fixtures rolled back`);
