// ============================================================================
// FDS 2.1 Day 9 — Canva 連接與匯入（F-AI-009，T-901）
// 決議：使用 chifung.login 帳戶；OAuth Authorization-Code＋PKCE 綁定使用者；
// 未取得有效權限不得使用他人 Canva 資料。匯入通路＝Design Imports：
// 前端生成 PPTX → edge 以 Bearer token 呼叫 POST /v1/imports → 輪詢 job →
// 回傳可編輯設計連結（edit_url 有效 30 天）。
// Client ID／Secret 存在 Supabase Edge secrets（CANVA_CLIENT_ID / CANVA_CLIENT_SECRET），
// 前端永遠拿不到 Secret；access/refresh token 存在無公認政策的 canva_connections 表。
// ============================================================================

import { supabase } from '@/lib/supabase';

const EDGE = 'supabase-functions-generate-canva-presentation';

export const CANVA_SCOPES = 'design:content:write design:meta:read profile:read';

export interface CanvaStatus {
  connected: boolean;
  configured: boolean;
  client_id?: string;
  account_name?: string | null;
  expires_at?: string | null;
}

/** 前端發出的 OAuth state nonce（sessionStorage 比對，防 CSRF）。 */
const STATE_KEY = 'fds-canva-oauth-state';
const VERIFIER_KEY = 'fds-canva-oauth-verifier';

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(EDGE, { body });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('canva_edge_no_response');
  return data as T;
}

/**
 * 走 PMS SSO／登入 callback 模式：redirect_uri 指回本 SPA 的
 * /fds/pm/presentation?canva_auth=...，由 PresentationView 接 code。
 * code_verifier 由前端生成（edge 不存，exchange 時傳回）。
 */
export function makeVerifier(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function fetchCanvaStatus(): Promise<CanvaStatus> {
  try {
    return await invoke<CanvaStatus>({ action: 'status' });
  } catch {
    return { connected: false, configured: false };
  }
}

/** 回傳 Canva 授權頁 URL；state 存 sessionStorage。 */
export async function startCanvaConnect(redirectUri: string): Promise<string> {
  const verifier = makeVerifier();
  const challenge = await s256(verifier);
  const status = await invoke<CanvaStatus>({ action: 'status' });
  if (!status.configured || !status.client_id) throw new Error('Canva 未配置（缺少 CANVA_CLIENT_ID）');
  const state = base64Url(crypto.getRandomValues(new Uint8Array(16)));
  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  const url = new URL('https://www.canva.com/api/oauth/authorize');
  url.searchParams.set('client_id', status.client_id);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', CANVA_SCOPES);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

export interface CanvaImportResult {
  design_id: string;
  edit_url: string;
  title?: string;
  /** 同一 staff 之前的匯入（最近 8 筆）。 */
  history?: { design_id: string; title?: string; edit_url?: string; created_at: string }[];
}

export async function importPptxToCanva(
  fileName: string,
  base64: string,
  productIds?: string[],
): Promise<CanvaImportResult> {
  return invoke<CanvaImportResult>({
    action: 'import',
    file_name: fileName,
    pptx_base64: base64,
    product_ids: productIds && productIds.length > 0 ? productIds : undefined,
  });
}

export async function canvaDisconnect(): Promise<void> {
  await invoke({ action: 'disconnect' });
}

/** 即便 Canva 授權回調失敗也要清掉 nonce。 */
export function clearCanvaOauthState(): void {
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
}

export interface CanvaOauthCallback {
  state: string | null;
  valid: boolean;
  verifier: string | null;
}

export function readCanvaOauthCallback(): CanvaOauthCallback {
  const url = new URL(window.location.href);
  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (error || !code || !state) return { state, valid: false, verifier: null };
  const expected = sessionStorage.getItem(STATE_KEY);
  if (!expected || expected !== state) return { state, valid: false, verifier: null };
  return { state, valid: true, verifier: sessionStorage.getItem(VERIFIER_KEY) };
}

export async function exchangeCanvaCode(code: string, verifier: string, redirectUri: string) {
  return invoke<CanvaStatus>({ action: 'exchange', code, code_verifier: verifier, redirect_uri: redirectUri });
}

/** blob → base64（無 data: 前綴），edge 端解碼。 */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
