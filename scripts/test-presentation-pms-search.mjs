import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';

function load(file, dependencies, globals = {}) {
  const context = { exports: {}, require: name => dependencies[name], console, ...globals };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  return context.exports;
}

const calls = [];
const client = { id: 'pms-customer', name: 'J Company', contactPerson: null, contactPhone: null, contactEmail: null, address: null, projects: [] };
const project = { id: 'pms-project', name: 'Office', code: 'BWF-1', projectType: null, note: null, client };
let failure = null;
const api = load('src/lib/presentationClients.ts', {
  '@/lib/supabase': { supabase: {
    from: () => ({ select() { return this; }, order: async () => ({ data: [], error: null }) }),
    functions: { invoke: async (slug, { body }) => {
      calls.push({ slug, body });
      return { data: body.action === 'presentation_clients' ? { clients: [client] } : { projects: [project] }, error: failure };
    } },
  } },
  '@/lib/edgeFunctionErrors': { parseInvokeError: async error => error.message },
  '@/lib/projectPartitionTemplates': { projectTypeLabel: type => type },
});
assert.equal((await api.loadPresentationClients('J'))[0]?.id, client.id, 'customer search must read PMS rather than FDS client_companies');
assert.equal(calls[0].slug, 'supabase-functions-fetch-pms-pitchings');
assert.equal(calls[0].body.search, 'J');
assert.equal((await api.loadPresentationProjects({ search: '1', customerId: client.id }))[0]?.id, project.id);
assert.equal(calls.at(-1).body.customer_id, client.id);
failure = new Error('PMS unavailable');
await assert.rejects(() => api.loadPresentationClients('J'), /PMS unavailable/, 'failures must not appear as no matches');
console.log('Presentation PMS client: remote search, customer filter and error propagation passed');

const server = load('supabase/functions/_shared/presentationLookup.ts', {});
const tables = {
  customers: [
    { id: 'c1', display_name: 'J Company', customer_name: 'Contact', phone_display: '123' },
    { id: 'c2', display_name: 'Same Company', company_name: 'Alias J' },
    ...Array.from({ length: 1200 }, (_, i) => ({ id: `extra-${i}`, display_name: `Company ${i}` })),
    { id: 'late', display_name: 'Zebra J unique' },
  ],
  bwf_projects: [
    { id: 'p1', project_name: 'Office', project_code: 'BWF-1', customer_id: 'c1', real_customer_display_name: 'Outdated company name' },
    { id: 'p2', project_name: 'Office', project_code: 'BWF-2', customer_id: 'c2' },
    { id: 'orphan', project_name: 'Standalone', project_code: 'BWF-3', customer_id: null },
  ],
};
const selections = [];
let failTable;
const db = { from(table) {
  let result = [...tables[table]];
  let cap = Infinity;
  const q = {
    select(columns) { selections.push({ table, columns }); return q; },
    order() { return q; },
    limit(value) { cap = value; return q; },
    eq(key, value) { result = result.filter(row => row[key] === value); return q; },
    in(key, values) { result = result.filter(row => values.includes(row[key])); return q; },
    or(expression) {
      result = result.filter(row => expression.split(',').some(part => {
        const [key, , pattern] = part.split('.');
        return String(row[key] || '').toLowerCase().includes(pattern.slice(1, -1).toLowerCase());
      }));
      return q;
    },
    then(resolve, reject) { return Promise.resolve({ data: result.slice(0, cap), error: table === failTable ? { message: 'query failed' } : null }).then(resolve, reject); },
  };
  return q;
} };
const found = await server.fetchPresentationLookup(db, { action: 'presentation_clients', search: 'Zebra J' });
assert.equal(found.clients[0].id, 'late', 'search must run on PMS before row limits, including customers beyond the first 1000');
assert.equal((await server.fetchPresentationLookup(db, { action: 'presentation_clients', search: 'Alias J' })).clients[0].id, 'c2', 'company aliases must remain searchable');
const byCode = await server.fetchPresentationLookup(db, { action: 'presentation_projects', search: '1' });
assert.equal(byCode.projects[0].id, 'p1', 'project code must be searchable');
assert.equal(byCode.projects[0].client.id, 'c1', 'customer link must use customer_id despite renamed display text');
const scoped = await server.fetchPresentationLookup(db, { action: 'presentation_projects', customer_id: 'c2' });
assert.equal(scoped.projects.length, 1);
assert.equal(scoped.projects[0].id, 'p2');
assert.ok((await server.fetchPresentationLookup(db, { action: 'presentation_projects' })).projects.some(row => row.id === 'orphan'), 'unlinked projects must remain selectable');
assert.equal((await server.fetchPresentationLookup(db, { action: 'presentation_clients', limit: 5000 })).clients.length, 50, 'lookup responses must be bounded');
assert.equal((await server.fetchPresentationLookup(db, { action: 'presentation_clients', search: 'missing' })).clients.length, 0);
for (const { columns } of selections) assert.doesNotMatch(columns, /\*|income|expense|profit|cost/);
failTable = 'customers';
await assert.rejects(() => server.fetchPresentationLookup(db, { action: 'presentation_clients' }), /query failed/);
await assert.rejects(() => server.fetchPresentationLookup(db, { action: 'presentation_projects', search: '1' }), /query failed/);
failTable = undefined;

let handler;
let permitted = true;
let signedIn = true;
load('supabase/functions/fetch-pms-pitchings/index.ts', {
  'jsr:@supabase/functions-js/edge-runtime.d.ts': {},
  'jsr:@supabase/supabase-js@2': { createClient: url => url === 'furniture' ? {
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: 'u1' } : null } }) },
    rpc: async () => ({ data: permitted }),
  } : db },
  '../_shared/pmsProject.ts': { pmsServiceRoleKey: () => 'test', pmsProjectUrl: () => 'pms' },
  '../_shared/presentationLookup.ts': server,
}, {
  Request, Response,
  Deno: { env: { get: name => name === 'SUPABASE_URL' ? 'furniture' : 'test' }, serve: fn => { handler = fn; } },
});
const request = () => handler(new Request('https://local.test', { method: 'POST', headers: { Authorization: 'Bearer test' }, body: JSON.stringify({ action: 'presentation_clients', search: 'J' }) }));
assert.equal((await request()).status, 200);
permitted = false;
assert.equal((await request()).status, 403, 'client/designer roles must not access customer contacts');
signedIn = false;
assert.equal((await request()).status, 401);
console.log('Presentation PMS edge: remote filtering, aliases, stable customer IDs, orphan projects, limits, error and authorization tests passed');
