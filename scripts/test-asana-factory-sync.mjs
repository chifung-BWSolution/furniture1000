import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

/**
 * FDS-12 去重與合併規則（離線）。真正 Asana API 與廠家物件對應仍未接上，
 * 這裡先鎖住「不重複追加、不來回寫入、Description 以 Asana 為主」。
 */

const source = fs.readFileSync('src/lib/asanaFactorySync.ts', 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const sandbox = { exports: {} };
sandbox.module = { exports: sandbox.exports };
vm.runInNewContext(code, sandbox);
const M = sandbox.exports;

// --- Description：Asana 為主，但遠端清空不刪本地 -------------------------
assert.deepEqual(Object.assign({}, M.mergeDescription('本地描述', 'Asana 描述')), { value: 'Asana 描述', source: 'asana' });
assert.deepEqual(Object.assign({}, M.mergeDescription('本地描述', '   ')), { value: '本地描述', source: 'local' });
assert.deepEqual(Object.assign({}, M.mergeDescription('同一段', '同一段')), { value: '同一段', source: 'unchanged' });
assert.deepEqual(Object.assign({}, M.mergeDescription('', '')), { value: '', source: 'unchanged' });

// --- 推送：已推過或有 gid 的不再推 ---------------------------------------
const local = [
  { id: 'c1', body: '想加一張茶几', authorName: 'Amy', createdAt: '2026-10-01T10:00:00Z', asanaGid: null },
  { id: 'c2', body: '已回覆客戶', authorName: 'Amy', createdAt: '2026-10-02T10:00:00Z', asanaGid: 'g-2' },
  { id: 'c3', body: '報價已更新\n\n— 由 FDS 同步', authorName: 'Amy', createdAt: '2026-10-03T10:00:00Z', asanaGid: null },
];
const remote = [
  { gid: 'g-1', body: '想加一張茶几\n\n— 由 FDS 同步', authorName: 'Amy', createdAt: '2026-10-01T10:00:05Z', type: 'comment' },
];
const toPush = Array.from(M.nextCommentsToPush(local, remote), (row) => row.id);
assert.deepEqual(toPush, ['c3'], 'only comments that are not on Asana yet are pushed');

// 重試：把 c3 推上去之後，遠端已有同一句，不應再推。
const remoteAfter = remote.concat([
  { gid: 'g-3', body: '報價已更新\n\n— 由 FDS 同步', authorName: 'Amy', createdAt: '2026-10-03T10:00:06Z', type: 'comment' },
]);
assert.equal(M.nextCommentsToPush(local, remoteAfter).length, 0, 'retrying does not duplicate an appended comment');

// --- 抄回：跳過自己的回聲與已知 gid -------------------------------------
const remoteFeed = [
  { gid: 'g-1', body: '想加一張茶几\n\n— 由 FDS 同步', authorName: 'Amy', createdAt: '2026-10-01T10:00:05Z', type: 'comment' },
  { gid: 'g-9', body: '客戶確認了', authorName: 'Leo', createdAt: '2026-10-04T09:00:00Z', type: 'comment' },
  { gid: 'g-10', body: 'system event', authorName: null, createdAt: '2026-10-04T09:01:00Z', type: 'system' },
  { gid: 'g-11', body: '同日較晚', authorName: 'Leo', createdAt: '2026-10-04T11:00:00Z', type: 'comment' },
];
const incoming = Array.from(M.newRemoteComments(remoteFeed, ['g-11']));
assert.deepEqual(Array.from(incoming, (row) => row.gid), ['g-9'], 'echo, system stories and known gids are skipped');
assert.equal(M.isIntegrationComment(remoteFeed[0].body), true);
assert.equal(M.isIntegrationComment(remoteFeed[1].body), false);

// 分頁重送去重
const paged = Array.from(M.dedupeRemoteComments([remoteFeed[0], remoteFeed[0], remoteFeed[1]]));
assert.deepEqual(Array.from(paged, (row) => row.gid), ['g-1', 'g-9']);

// 推送標記只加一次
const marked = M.withSyncMarker('同一句');
assert.equal(marked.endsWith('— 由 FDS 同步'), true);
assert.equal(M.withSyncMarker(marked), marked, 'marker is not added twice');
assert.equal(M.normalizeCommentBody(marked), '同一句', 'marker is stripped when comparing bodies');

// --- 狀態 ---------------------------------------------------------------
assert.equal(M.syncState({ hasLocal: true, hasRemote: true, descriptionSource: 'unchanged' }), 'synced');
assert.equal(M.syncState({ hasLocal: true, hasRemote: true, descriptionSource: 'asana' }), 'conflict');
assert.equal(M.syncState({ hasLocal: true, hasRemote: false, descriptionSource: 'local' }), 'local_only');
assert.equal(M.syncState({ hasLocal: false, hasRemote: true, descriptionSource: 'asana' }), 'remote_only');

console.log('PASS Asana merge, push dedupe, echo guard and pagination dedupe');
