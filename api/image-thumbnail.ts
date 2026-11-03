import { createClient } from '@supabase/supabase-js';

export const maxDuration = 30;
const pending = new Map<string, Promise<string>>();
const BUCKET = 'product-images';

/** Only public images from this deployment's own project can be materialized. */
export async function GET(req: Request): Promise<Response> {
  const path = new URL(req.url).searchParams.get('path') || '';
  if (!path || path.length > 1024 || path.split('/').some(p => !p || p === '.' || p === '..')
    || path.includes('\\') || path.startsWith('__thumbs/') || !/\.(jpe?g|png|webp)$/i.test(path)) {
    return new Response('Invalid image path', {status:400});
  }
  const base = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!/^https:\/\/(riaubhtruisbwdlwjzur|omxizeukbcqzsnjsuwod)\.supabase\.co$/.test(base) || !key) {
    return new Response('Image service unavailable', {status:503});
  }
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const original = `${base}/storage/v1/object/public/${BUCKET}/${encoded}`;
  const target = `__thumbs/v1/${path}.webp`;
  const stored = `${base}/storage/v1/object/public/${BUCKET}/__thumbs/v1/${encoded}.webp`;
  const redirect = (url: string, cached: boolean) => new Response(null, {status:302,headers:{Location:url,'Cache-Control':cached?'public, max-age=86400, s-maxage=86400':'no-store'}});
  try {
    const exists = await fetch(stored, {method:'HEAD', signal:AbortSignal.timeout(5000)});
    if(exists.ok) return redirect(stored,true);
    if(exists.status!==404 && exists.status!==400) return redirect(original,false);
    let task=pending.get(path);
    if(!task) {
      task=(async()=>{
        // Restrict work to an existing, bounded public original. Never fetch a caller URL.
        const source=await fetch(original,{method:'HEAD',signal:AbortSignal.timeout(5000)});
        if(!source.ok || !source.headers.get('content-type')?.startsWith('image/') || Number(source.headers.get('content-length') || 0)>20000000) return original;
        const rendered=await fetch(`${base}/storage/v1/render/image/public/${BUCKET}/${encoded}?width=640&height=640&resize=contain&quality=65`,{signal:AbortSignal.timeout(15000)});
        if(!rendered.ok || !rendered.headers.get('content-type')?.startsWith('image/')) return original;
        const bytes=await rendered.arrayBuffer();
        if(bytes.byteLength>5000000) return original;
        const db=createClient(base,key,{auth:{persistSession:false,autoRefreshToken:false}});
        const {error}=await db.storage.from(BUCKET).upload(target,bytes,{contentType:rendered.headers.get('content-type')!,cacheControl:'31536000',upsert:false});
        if(error) {
          const winner=await fetch(stored,{method:'HEAD',signal:AbortSignal.timeout(5000)});
          if(!winner.ok) return original;
        }
        return stored;
      })().finally(()=>pending.delete(path));
      pending.set(path,task);
    }
    const result=await task;
    return redirect(result,result===stored);
  } catch { return redirect(original,false); }
}
