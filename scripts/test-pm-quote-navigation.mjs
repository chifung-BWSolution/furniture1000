import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';

const context = { exports: {}, require(name) {
  assert.equal(name, 'lucide-react');
  return {};
} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/components/dashboard/navConfig.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, context);
const nav = context.exports;
const section = nav.getSection('quote');
assert.deepEqual(Array.from(nav.filterNavChildren(section.children, false, { pm: true }), c => c.view), [
  'fds2-quote-quick', 'fds2-quote-common', 'fds2-quote-list',
  'fds2-quote-large', 'fds2-quote-photos',
]);
assert.equal(nav.getFirstVisibleView('quote', false, { pm: true }), 'fds2-quote-quick');
for (const item of section.children) {
  assert.equal(nav.isPmBlockedQuoteView(item.view), item.view === 'fds2-quote-format');
  const legacy = nav.implementedPage(item.view);
  if (legacy) assert.equal(nav.isPmBlockedQuoteView(legacy), false);
}
assert.equal(nav.isPmBlockedQuoteView('design-projects'), false);
assert.equal(nav.filterNavChildren(section.children, true).some(c => c.view === 'fds2-quote-format'), true);
assert.equal(nav.filterNavChildren(nav.getSection('admin').children, false, { pm: true }).some(c => c.adminOnly), false);
console.log('PASS: PM quote navigation, legacy routes, format exclusion, admin boundaries');
