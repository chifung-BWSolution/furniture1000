/**
 * FDS-12 Asana 廠家同步的純邏輯（第一版：廠家 Description 與 Comment，Asana 為主）。
 *
 * 只做可以離線測試的部分：合併規則、去重、防來回寫入。
 * 真正的 Asana API 呼叫與資料表要等「Asana 憑證 + 測試任務 GID + 廠家物件對應」確定後才接，
 * 不在這裡猜 ID，也不假裝已連線。
 */

/** 我們推到 Asana 的留言會加上這一行，用來辨認自己的回聲，避免來回寫入。 */
export const ASANA_SYNC_MARKER = '— 由 FDS 同步';

export type AsanaComment = {
  gid: string;
  body: string;
  authorName: string | null;
  createdAt: string;
  /** Asana story 的 type；`comment` 才是留言。 */
  type?: string | null;
};

export type FdsComment = {
  id: string;
  body: string;
  authorName: string | null;
  createdAt: string;
  /** 已推到 Asana 的 story gid；null 表示未推。 */
  asanaGid?: string | null;
};

export type DescriptionMerge = {
  value: string;
  /** asana = 用 Asana 值；local = 保留本地；unchanged = 兩邊一樣。 */
  source: 'asana' | 'local' | 'unchanged';
};

export function normalizeCommentBody(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(new RegExp(`\\s*${ASANA_SYNC_MARKER}\\s*$`), '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function isIntegrationComment(body: string): boolean {
  return body.includes(ASANA_SYNC_MARKER);
}

/** 推送時加標記；已加過就不重複。 */
export function withSyncMarker(body: string): string {
  const base = body.replace(/\s+$/, '');
  return isIntegrationComment(base) ? base : `${base}\n\n${ASANA_SYNC_MARKER}`;
}

/**
 * Description 衝突：Asana 為主。
 * - 遠端有值且與本地不同 → 用 Asana。
 * - 遠端為空 → 保留本地（不把 Asana 的清空當成刪除本地內容）。
 * - 兩邊一樣 → unchanged。
 */
export function mergeDescription(local: string, remote: string | null | undefined): DescriptionMerge {
  const localText = (local ?? '').trim();
  const remoteText = (remote ?? '').trim();
  if (!remoteText) {
    return { value: localText, source: localText ? 'local' : 'unchanged' };
  }
  if (remoteText === localText) return { value: localText, source: 'unchanged' };
  return { value: remoteText, source: 'asana' };
}

function commentKey(body: string, authorName: string | null): string {
  return `${normalizeCommentBody(body).toLowerCase()}|${(authorName ?? '').trim().toLowerCase()}`;
}

/**
 * 要推到 Asana 的本地留言：
 * - 已有 asanaGid 的跳過（已推過）。
 * - 內容與作者已存在於遠端（例如上次推送成功但未來得及記 gid）也跳過，重試不會重複追加。
 */
export function nextCommentsToPush(local: FdsComment[], remote: AsanaComment[]): FdsComment[] {
  const remoteKeys = new Set(
    remote
      .filter((row) => !row.type || row.type === 'comment')
      .map((row) => commentKey(row.body, row.authorName)),
  );
  return local.filter((row) => {
    if (row.asanaGid) return false;
    if (!normalizeCommentBody(row.body)) return false;
    return !remoteKeys.has(commentKey(row.body, row.authorName));
  });
}

/**
 * 要抄回本地的新遠端留言：跳過自己推上去的回聲與已記錄的 gid。
 * 回傳按時間排序，避免先後倒轉。
 */
export function newRemoteComments(
  remote: AsanaComment[],
  knownGids: Iterable<string>,
): AsanaComment[] {
  const known = new Set(knownGids);
  return remote
    .filter((row) => (!row.type || row.type === 'comment') && !known.has(row.gid))
    .filter((row) => !isIntegrationComment(row.body))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** 同一批遠端留言可能分頁重送，這裡按 gid 去重。 */
export function dedupeRemoteComments(remote: AsanaComment[]): AsanaComment[] {
  const seen = new Set<string>();
  const out: AsanaComment[] = [];
  for (const row of remote) {
    if (!row.gid || seen.has(row.gid)) continue;
    seen.add(row.gid);
    out.push(row);
  }
  return out;
}

export type AsanaSyncState = 'synced' | 'local_only' | 'remote_only' | 'conflict';

/** 給 UI／記錄用的狀態，不猜任何遠端資料。 */
export function syncState(input: {
  hasLocal: boolean;
  hasRemote: boolean;
  descriptionSource: DescriptionMerge['source'];
}): AsanaSyncState {
  if (!input.hasLocal && !input.hasRemote) return 'local_only';
  if (!input.hasRemote) return 'local_only';
  if (!input.hasLocal) return 'remote_only';
  return input.descriptionSource === 'asana' ? 'conflict' : 'synced';
}

export const ASANA_SYNC_STATE_LABELS: Record<AsanaSyncState, string> = {
  synced: '已同步',
  local_only: '只在 FDS',
  remote_only: '只在 Asana',
  conflict: 'Asana 較新（已用 Asana 值）',
};
