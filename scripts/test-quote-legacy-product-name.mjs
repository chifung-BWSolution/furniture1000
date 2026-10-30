import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = fs.readFileSync('src/components/dashboard/QuotationDraftEditor.tsx','utf8');
const start=source.indexOf('function mapInputToQuotationItem(');
const end=source.indexOf('\nexport function ',start+10);
const code=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const ctx={};vm.createContext(ctx);vm.runInContext(code,ctx);
const row={id:'production-fixture',name:'',category:'摺枱',hkdCostPrice:0};
assert.equal(ctx.mapInputToQuotationItem(row).name,'摺枱');
assert.equal(ctx.mapInputToQuotationItem({...row,name:'自訂名稱'}).name,'自訂名稱');
assert.equal(ctx.mapInputToQuotationItem({...row,isSectionTitle:true}).name,'');
assert.equal(ctx.mapInputToQuotationItem({...row,isCustomTerm:true}).name,'');
assert.equal(ctx.mapInputToQuotationItem(row).category,'摺枱');
console.log('Legacy quote product name regression checks passed');

