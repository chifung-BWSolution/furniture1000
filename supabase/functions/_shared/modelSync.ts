import { createHash } from 'node:crypto';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const DEV = 'omxizeukbcqzsnjsuwod';
const PROD = 'riaubhtruisbwdlwjzur';
const BUCKET = 'product-models';
const fields = ['product_id','model_type','format','source','file_name','size_bytes','content_hash','version_note','created_at','generation_mode','preview_status','preview_error','preview_updated_at','preview_content_hash'];
const pathFields = ['storage_path','preview_storage_path','bundle_storage_path'];
export function destinationPath(path: string) {
  if (!/^(uploaded|generated|preview|promoted)\//.test(path) || path.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('invalid_model_path');
  return `generated/develop-sync/${path}`;
}
export function modelPayload(model: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  for (const f of fields) if (f in model) result[f] = model[f];
  for (const f of pathFields) result[f] = model[f] ? destinationPath(String(model[f])) : null;
  // User, job and furniture-model IDs belong to the source database; never copy their foreign keys.
  return result;
}
function checked<T extends {error: unknown}>(result: T): T {
  if (result.error) throw new Error('model_sync_database_operation_failed');
  return result;
}
async function copyArtifact(path: string, sourceKey: string, targetKey: string) {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const source = await fetch(`https://${DEV}.supabase.co/storage/v1/object/${BUCKET}/${encoded}`, {headers:{Authorization:`Bearer ${sourceKey}`}});
  if (!source.ok) throw new Error(`source_download_${source.status}`);
  const bytes = new Uint8Array(await source.arrayBuffer());
  if (bytes.length > 100*1024*1024) throw new Error('model_sync_file_too_large');
  const expected = createHash('sha256').update(bytes).digest('hex');
  const dest = destinationPath(path).split('/').map(encodeURIComponent).join('/');
  const url = `https://${PROD}.supabase.co/storage/v1/object/${BUCKET}/${dest}`;
  const uploaded = await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${targetKey}`,apikey:targetKey,'Content-Type':source.headers.get('content-type') || 'application/octet-stream','x-upsert':'true'},body:bytes});
  if (!uploaded.ok) throw new Error(`target_upload_${uploaded.status}`);
  const verified = await fetch(url,{headers:{Authorization:`Bearer ${targetKey}`}});
  if (!verified.ok || !verified.body) throw new Error('model_sync_verify_failed');
  const digest=createHash('sha256'); let total=0;
  for await (const chunk of verified.body) { total+=chunk.length;digest.update(chunk); }
  if(total!==bytes.length || digest.digest('hex')!==expected) throw new Error('model_sync_hash_mismatch');
}
export async function syncDevelopModels(source: SupabaseClient, target: SupabaseClient, sourceKey: string, targetKey: string) {
  const claim=checked(await source.rpc('fds_claim_model_sync'));
  if(!claim.data) return {ok:true,idle:true};
  const {model,revision,paths}=claim.data;
  try {
    const product=checked(await source.from('products').select('id,model,sku').eq('id',model.product_id).single()).data;
    const targetProduct=checked(await target.from('products').select('id,model,sku').eq('id',model.product_id).single()).data;
    if(!product || !targetProduct || product.model!==targetProduct.model || product.sku!==targetProduct.sku) throw new Error('target_product_identity_mismatch');
    const payload=modelPayload(model);
    const owned=checked(await target.from('product_models').select('id').eq('storage_path',payload.storage_path).maybeSingle()).data;
    let identical=false;
    if(!owned && model.content_hash) {
      const existing=checked(await target.from('product_models').select('id').eq('product_id',model.product_id).eq('format',model.format).eq('content_hash',model.content_hash).limit(1)).data;
      identical=!!existing?.length;
    }
    if(!identical) {
      const required=pathFields.flatMap(f=>model[f]?[String(model[f])]:[]);
      const allPaths=[...new Set<string>([...required,...paths])];
      for(const path of allPaths) await copyArtifact(path,sourceKey,targetKey);
      checked(await target.from('product_models').upsert(payload,{onConflict:'storage_path'}));
    }
    checked(await source.rpc('fds_finish_model_sync',{p_id:model.id,p_revision:revision,p_error:null}));
    return {ok:true,model_id:model.id,already_present:identical};
  } catch(error) {
    const message=error instanceof Error?error.message:'model_sync_failed';
    checked(await source.rpc('fds_finish_model_sync',{p_id:model.id,p_revision:revision,p_error:message}));
    return {ok:false,model_id:model.id,error:message,retry:true};
  }
}
