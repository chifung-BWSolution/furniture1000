import fs from 'node:fs';
const env=fs.readFileSync('.env.local','utf8');const token=process.env.SUPABASE_ACCESS_TOKEN??env.match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g,'');
const ref='omxizeukbcqzsnjsuwod';const headers={Authorization:`Bearer ${token}`};
const secrets=await fetch(`https://api.supabase.com/v1/projects/${ref}/secrets`,{headers});const list=await secrets.json();console.log('Gamma secret on develop:',Array.isArray(list)&&list.some(x=>x.name==='GAMMA_API_KEY'));
const form=new FormData();form.append('metadata',new Blob([JSON.stringify({name:'supabase-functions-generate-canva-presentation',entrypoint_path:'index.ts',verify_jwt:false})],{type:'application/json'}),'meta.json');
for(const name of fs.readdirSync('supabase/functions/generate-canva-presentation').filter(x=>x.endsWith('.ts')))form.append('file',new Blob([fs.readFileSync(`supabase/functions/generate-canva-presentation/${name}`)],{type:'application/typescript'}),name);
const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/functions/deploy?slug=supabase-functions-generate-canva-presentation`,{method:'POST',headers,body:form});console.log('deploy',r.status,(await r.text()).slice(0,400));if(!r.ok)process.exitCode=1;
