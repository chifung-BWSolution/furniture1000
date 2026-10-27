import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

const ref = process.argv.find(a => a.startsWith('--ref='))?.slice(6);
if (!ref) throw new Error('Explicit --ref required');
const token = process.env.SUPABASE_ACCESS_TOKEN || fs.readFileSync('.env.local', 'utf8').match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m)?.[1]?.trim();
const id = randomUUID();
const email = `photo-permission-${id}@example.invalid`;
const migration = process.argv.includes('--installed') ? '' : fs.readFileSync('supabase/migrations/20261027120000_pm_quote_photo_management.sql', 'utf8');
const query = `begin;
${migration}
insert into public.platform_user_profiles(email,role,active) values ('${email}','pm',true);
select set_config('request.jwt.claims','${JSON.stringify({ sub: id, email, role: 'authenticated' })}',true);
set local role authenticated;
insert into public.quote_photo_assets(id,title,object_path,mime_type) values ('${id}','QA','library/qa-${id}.png','image/png');
update public.quote_photo_assets set title='QA updated',sort_order=4 where id='${id}';
do $$ begin
  if not exists(select 1 from public.quote_photo_assets where id='${id}' and title='QA updated' and sort_order=4) then
    raise exception 'PM image update failed';
  end if;
end $$;
delete from public.quote_photo_assets where id='${id}';
do $$ begin
  if exists(select 1 from public.quote_photo_assets where id='${id}') then raise exception 'PM image delete failed'; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from pg_policies where schemaname='storage' and policyname in ('quote_photos_objects_insert','quote_photos_objects_delete') and coalesce(qual,with_check) like '%''pm''%') <> 2 then
    raise exception 'PM storage policies missing';
  end if;
end $$;
update public.platform_user_profiles set role='client' where email='${email}';
set local role authenticated;
do $$ begin
  begin
    insert into public.quote_photo_assets(title,object_path,mime_type) values ('QA','library/qa-client-${id}.png','image/png');
    raise exception 'Client unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
rollback;`;
const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
});
if (!response.ok) throw new Error(await response.text());
console.log(`PASS ${ref}: PM image CRUD, storage policies, client rejection; fixtures rolled back`);
