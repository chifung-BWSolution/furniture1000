import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { pmsProjectUrl, pmsServiceRoleKey } from "../_shared/pmsProject.ts";

/**
 * FDS-12 第一版（唯讀）Asana 廠家同步 worker。
 *
 * 只把 Asana 專案「BWFS 辦公室傢俬廠 Office Furniture Listing」每個 task 的
 * Description 與 Comment 讀進 FDS（`fds_asana_factory_link`／`_comment`）。
 * **不向 Asana 寫任何留言**；寫入方向要另外取得明確授權後才做。
 *
 * 授權：x-worker-secret（pg_cron／vault）或 admin／uploader／pm 登入帳號。
 * 需要 edge secret `ASANA_ACCESS_TOKEN`（未設定時回 503 asana_not_configured）。
 * 部署要用 supabase CLI（shared 無 import 但仍建議整包部署）：
 *   npx supabase functions deploy sync-asana-factories --project-ref <ref>
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-worker-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CALLER_ROLES = ["admin", "uploader", "pm"];
const ASANA_BASE = "https://app.asana.com/api/1.0";
const PROGRESS_MARKER = "— 由 FDS 同步";

type LinkRow = {
  id: string;
  factory_id: string;
  factory_name: string;
  asana_task_gid: string;
  enabled: boolean;
};

type AsanaStory = {
  gid: string;
  type?: string | null;
  text?: string | null;
  created_at?: string | null;
  created_by?: { name?: string | null } | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function adminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function authorize(req: Request, admin: SupabaseClient): Promise<Response | null> {
  const workerSecret = req.headers.get("x-worker-secret");
  if (workerSecret !== null) {
    const secret = workerSecret.trim();
    if (!secret) return json({ error: "Unauthorized" }, 401);
    const { data, error } = await admin.rpc("fds_worker_verify_secret", { p_secret: secret });
    if (error || data !== true) return json({ error: "Unauthorized" }, 401);
    return null;
  }
  const jwt = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(\S+)$/i)?.[1]?.trim() ?? "";
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!jwt || !url || !anonKey) return json({ error: "Unauthorized" }, 401);
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(jwt);
  if (userError || !userData.user?.id) return json({ error: "Unauthorized" }, 401);
  const { data: allowed, error: roleError } = await userClient.rpc("bwf_has_role", { p_roles: CALLER_ROLES });
  if (roleError || allowed !== true) return json({ error: "permission_denied" }, 403);
  return null;
}

async function asanaGet(token: string, path: string): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(`${ASANA_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

function commentsFrom(stories: AsanaStory[]): Array<{ gid: string; body: string; author: string; created_at: string | null }> {
  return stories
    .filter((story) => (!story.type || story.type === "comment") && typeof story.text === "string")
    .filter((story) => !String(story.text ?? "").includes(PROGRESS_MARKER))
    .map((story) => ({
      gid: story.gid,
      body: String(story.text ?? ""),
      author: String(story.created_by?.name ?? ""),
      created_at: story.created_at ?? null,
    }));
}

async function refreshAsanaToken(refreshToken: string): Promise<{ access_token?: string; refresh_token?: string; expires_in?: number } | null> {
  const clientId = Deno.env.get("ASANA_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("ASANA_CLIENT_SECRET") ?? "";
  if (!clientId || !clientSecret || !refreshToken) return null;
  const res = await fetch("https://app.asana.com/-/oauth_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }).toString(),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.access_token) return null;
  return body;
}

/**
 * 對齊 QMS：一般職員用自己 OAuth 連接的 token；cron（worker secret）沒有用戶身分，
 * 才用 edge secret 的 `ASANA_ACCESS_TOKEN` 作系統連線。Token 不會回傳前端。
 */
async function resolveAsanaToken(req: Request, admin: SupabaseClient): Promise<{ token: string; source: string }> {
  if (req.headers.get("x-worker-secret") !== null) {
    return { token: (Deno.env.get("ASANA_ACCESS_TOKEN") ?? "").trim(), source: "pat_cron" };
  }
  const jwt = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(\S+)$/i)?.[1]?.trim() ?? "";
  if (jwt) {
    const { data: userData } = await admin.auth.getUser(jwt);
    const uid = userData.user?.id ?? null;
    if (uid) {
      const { data: row } = await admin
        .from("fds_asana_oauth_tokens")
        .select("access_token,refresh_token,expires_at,asana_user_gid,asana_user_name")
        .eq("auth_user_id", uid)
        .maybeSingle();
      const record = row as {
        access_token?: string | null;
        refresh_token?: string | null;
        expires_at?: string | null;
        asana_user_gid?: string | null;
        asana_user_name?: string | null;
      } | null;
      if (record?.access_token) {
        const expiring = record.expires_at ? new Date(record.expires_at).getTime() < Date.now() + 60_000 : false;
        if (!expiring) return { token: record.access_token, source: "oauth" };
        if (record.refresh_token) {
          const refreshed = await refreshAsanaToken(record.refresh_token);
          if (refreshed?.access_token) {
            await admin.rpc("fds_asana_oauth_save", {
              p_auth_user_id: uid,
              p_access_token: refreshed.access_token,
              p_refresh_token: refreshed.refresh_token ?? record.refresh_token,
              p_expires_at: refreshed.expires_in
                ? new Date(Date.now() + Number(refreshed.expires_in) * 1000).toISOString()
                : record.expires_at ?? null,
              p_asana_user_gid: record.asana_user_gid ?? null,
              p_asana_user_name: record.asana_user_name ?? null,
            });
            return { token: refreshed.access_token, source: "oauth_refreshed" };
          }
        }
      }
    }
  }
  return { token: (Deno.env.get("ASANA_ACCESS_TOKEN") ?? "").trim(), source: "pat" };
}

function parsePmsTaskGid(value: unknown): string | null {
  const text = String(value ?? "").trim();
  const match = text.match(/\/task\/(\d{6,25})/);
  return match ? match[1] : null;
}

/**
 * PMS factories.asana_link 優先：把有效的 task URL 寫成 link（source='pms'）。
 * 只接受 /task/<gid>；'asanalink' 或搜尋 URL 之類一律忽略，保留手動綁定作 fallback。
 */
async function reconcilePmsFactoryLinks(admin: SupabaseClient): Promise<number> {
  const base = pmsProjectUrl();
  const key = pmsServiceRoleKey();
  if (!base || !key) return 0;
  const res = await fetch(
    `${base}/rest/v1/factories?select=id,display_name,factory_code,asana_link&asana_link=not.is.null&limit=500`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!res.ok) return 0;
  const rows = (await res.json().catch(() => [])) as Array<{
    id?: string;
    display_name?: string;
    factory_code?: string;
    asana_link?: string;
  }>;
  let count = 0;
  for (const row of rows) {
    const gid = parsePmsTaskGid(row.asana_link);
    if (!row.id || !gid) continue;
    const { error } = await admin.from("fds_asana_factory_link").upsert(
      {
        factory_id: row.id,
        factory_name: String(row.display_name || row.factory_code || "未命名廠家").slice(0, 200),
        asana_task_gid: gid,
        asana_project_gid: "1155109275123381",
        source: "pms",
        enabled: true,
      },
      { onConflict: "factory_id" },
    );
    if (!error) count += 1;
  }
  return count;
}

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let admin: SupabaseClient;
  try {
    admin = adminClient();
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Server misconfigured" }, 500);
  }

  const denied = await authorize(req, admin);
  if (denied) return denied;

  const resolved = await resolveAsanaToken(req, admin);
  const token = resolved.token;
  if (!token) return json({ error: "asana_not_configured" }, 503);

  const pmsLinks = await reconcilePmsFactoryLinks(admin);

  let body: { link_id?: string; limit?: number } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const limit = Math.min(Math.max(Number(body.limit) || 10, 1), 50);

  let query = admin
    .from("fds_asana_factory_link")
    .select("id, factory_id, factory_name, asana_task_gid, enabled")
    .eq("enabled", true)
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (body.link_id) query = query.eq("id", body.link_id);

  const { data: links, error: linkError } = await query;
  if (linkError) return json({ error: linkError.message }, 500);

  const results: Array<{ link_id: string; factory: string; status: string; comments?: number; pushed?: number; edited?: number; removed?: number; error?: string }> = [];

  for (const link of (links ?? []) as LinkRow[]) {
    try {
      const task = await asanaGet(token, `/tasks/${link.asana_task_gid}?opt_fields=notes,modified_at`);
      if (!task.ok) throw new Error(`asana_task_${task.status}`);
      const taskData = (task.body as { data?: { notes?: string; modified_at?: string } })?.data ?? {};

      // Stories are paginated; walk up to 5 pages of 100 so long comment threads still sync.
      const comments: Array<{ gid: string; body: string; author: string; created_at: string | null }> = [];
      const seenStoryGids = new Set<string>();
      let offset: string | null = null;
      for (let page = 0; page < 5; page += 1) {
        const stories = await asanaGet(
          token,
          `/tasks/${link.asana_task_gid}/stories?limit=100&opt_fields=type,text,created_at,created_by.name${offset ? `&offset=${encodeURIComponent(offset)}` : ""}`,
        );
        if (!stories.ok) throw new Error(`asana_stories_${stories.status}`);
        const storyRows = ((stories.body as { data?: AsanaStory[] })?.data ?? []);
        for (const comment of commentsFrom(storyRows)) {
          if (seenStoryGids.has(comment.gid)) continue;
          seenStoryGids.add(comment.gid);
          comments.push(comment);
        }
        offset = (stories.body as { next_page?: { offset?: string } | null })?.next_page?.offset ?? null;
        if (!offset) break;
      }

      const { data: applied, error: applyError } = await admin.rpc("fds_asana_factory_apply", {
        p_link_id: link.id,
        p_description: String(taskData.notes ?? ""),
        p_modified_at: taskData.modified_at ?? null,
        p_comments: comments,
      });
      if (applyError) throw new Error(applyError.message);

      // FDS → Asana：把本地新增的留言追加到同一個 task（只追加，不改既有留言）。
      let pushed = 0;
      const { data: pending } = await admin.rpc("fds_asana_comment_pending_push", {
        p_link_id: link.id,
        p_limit: 10,
      });
      for (const comment of (Array.isArray(pending) ? pending as Array<{ id: string; body: string }> : [])) {
        try {
          const postRes = await fetch(`${ASANA_BASE}/tasks/${link.asana_task_gid}/stories`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ data: { text: `${comment.body}\n\n${PROGRESS_MARKER}` } }),
          });
          const postBody = await postRes.json().catch(() => null);
          const storyGid = (postBody as { data?: { gid?: string } } | null)?.data?.gid;
          if (!postRes.ok || !storyGid) throw new Error(`asana_story_${postRes.status}`);
          await admin.rpc("fds_asana_comment_mark_pushed", { p_id: comment.id, p_gid: storyGid });
          pushed += 1;
        } catch (pushError) {
          await admin.rpc("fds_asana_comment_mark_push_failed", {
            p_id: comment.id,
            p_error: pushError instanceof Error ? pushError.message : "push_failed",
          });
        }
      }

      // 編輯／刪除已推送的 FDS 留言：Asana stories 不支援 update，編輯＝刪舊 story 再 POST 新內容。
      let edited = 0;
      let removed = 0;
      const { data: changes } = await admin.rpc("fds_asana_comment_pending_sync", {
        p_link_id: link.id,
        p_limit: 10,
      });
      for (const change of (Array.isArray(changes) ? changes as Array<{ id: string; asana_gid: string | null; body: string; delete_pending: boolean; update_pending: boolean }> : [])) {
        try {
          if (change.asana_gid) {
            const del = await fetch(`${ASANA_BASE}/stories/${change.asana_gid}`, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!del.ok && del.status !== 404) throw new Error(`asana_delete_${del.status}`);
          }
          if (change.delete_pending) {
            await admin.rpc("fds_asana_comment_mark_deleted", { p_id: change.id });
            removed += 1;
            continue;
          }
          const postRes = await fetch(`${ASANA_BASE}/tasks/${link.asana_task_gid}/stories`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ data: { text: `${change.body}\n\n${PROGRESS_MARKER}` } }),
          });
          const postBody = await postRes.json().catch(() => null);
          const storyGid = (postBody as { data?: { gid?: string } } | null)?.data?.gid;
          if (!postRes.ok || !storyGid) throw new Error(`asana_story_${postRes.status}`);
          await admin.rpc("fds_asana_comment_mark_updated", { p_id: change.id, p_gid: storyGid });
          edited += 1;
        } catch (syncError) {
          await admin.rpc("fds_asana_comment_mark_sync_failed", {
            p_id: change.id,
            p_error: syncError instanceof Error ? syncError.message : "sync_failed",
          });
        }
      }

      results.push({
        link_id: link.id,
        factory: link.factory_name,
        status: "synced",
        comments: Number((applied as { inserted_comments?: number } | null)?.inserted_comments ?? 0),
        pushed,
        edited,
        removed,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "sync failed";
      await admin.rpc("fds_asana_factory_mark_error", { p_link_id: link.id, p_error: message });
      results.push({ link_id: link.id, factory: link.factory_name, status: "error", error: message });
    }
  }

  return json({ ok: true, mode: "read_only", token_source: resolved.source, pms_links: pmsLinks, processed: results.length, results });
}

Deno.serve(async (req: Request) => {
  try {
    return await handle(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[sync-asana-factories]", error);
    return json({ error: message, stack: error instanceof Error ? String(error.stack).slice(0, 800) : null }, 500);
  }
});
