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

assert.equal(nav.findSection('fds2-pm-quick'), 'pm');
assert.equal(nav.getViewMeta('fds2-pm-quick').viewLabel, '報價預算');
// 報價預算 > 新增預算／開啟舊單 lands on the hidden /fds/pm/quick form; 側欄 must highlight 報價預算.
assert.equal(nav.navItemIsActive('fds2-pm-budget', 'fds2-pm-quick'), true);
assert.equal(nav.navItemIsActive('fds2-pm-package', 'fds2-pm-quick'), false);
console.log('PASS: hidden quick quote keeps 報價預算 highlighted');
