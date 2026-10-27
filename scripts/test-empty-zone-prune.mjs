import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync('src/lib/syncProjectZones.ts', 'utf8');
const start = source.indexOf('export function pairSeedsWithZones');
const end = source.indexOf('export async function syncProjectZones');
assert.ok(start > 0 && end > start, 'zone pairing helpers are present');
const snippet = source.slice(start, end).replace(/^export /gm, '');
const code = ts.transpileModule(snippet, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

const sandbox = {};
vm.runInNewContext(
  `${code}\nglobalThis.pair = pairSeedsWithZones;\nglobalThis.prune = emptyZoneIdsToPrune;`,
  sandbox,
);

const zone = (id, name, roomKey, code = null) => ({
  id,
  projectId: 'p',
  name,
  code,
  roomKey,
  bounds: { x: 0, y: 0, w: 1, h: 1 },
  aiSuggested: false,
  sortOrder: 0,
});

const renamed = zone('zone-meeting', '大會議室', 'meeting', 'M1');
const leftover = zone('zone-old', '舊儲物室', 'storage', 'S1');
const occupied = zone('zone-lobby', '大堂', 'lobby', 'L1');
const seeds = [
  { name: '會議室', code: 'MR', roomKey: 'meeting', bounds: renamed.bounds },
  { name: '大堂', code: 'LB', roomKey: 'lobby', bounds: occupied.bounds },
];
const products = [{ zoneId: 'zone-lobby' }];

const pruned = sandbox.prune(seeds, [renamed, leftover, occupied], products);
assert.deepEqual(pruned, ['zone-old'], 'only the unmatched empty zone is pruned');

const paired = sandbox.pair(seeds, [renamed, occupied]);
assert.equal(paired[0].zone.id, 'zone-meeting');
assert.equal(paired[0].zone.name, '大會議室');
assert.equal(paired[0].zone.code, 'M1');
assert.equal(paired[1].zone.id, 'zone-lobby');

console.log('PASS empty zone prune keeps renamed room key, code, and id');
