import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compile = (s) => ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const source=fs.readFileSync('src/lib/bwfQuoteItems.ts','utf8');
const ctx={exports:{},require:()=>({})};vm.createContext(ctx);vm.runInContext(compile(source),ctx);
const M=ctx.exports;
for (const mode of ['lwh','dh']) {
 const payload=M.mapItemToRow({id:'fixture',name:'table',dimensionMode:mode,dimensionLMm:'1000+600',dimensionHMm:'750'},0);
 const result=M.mapRowToItem(payload);
 assert.equal(result.dimensionMode,mode);
 assert.equal(result.dimensionLMm,'1000+600');
}
assert.equal(M.mapRowToItem({}).dimensionMode,'lwh');
const editor=fs.readFileSync('src/components/dashboard/QuotationDraftEditor.tsx','utf8');
const start=editor.indexOf('  // Load line items from bwf_quote_item');
const end=editor.indexOf('\n  useEffect(',editor.indexOf('}, [existingQuote?.quoteUuid]);',start));
const effect=editor.slice(start,end);
for (const failure of [true,false]) {
 let loaded=false, callback, message=false;
 const sandbox={existingQuote:{quoteUuid:'fixture'},legacyItems:[],itemsHydratedForUuidRef:{current:null},itemsUserEditedRef:{current:false},itemsRef:{current:[]},hasQuoteItemContent:()=>false,setItemsLoadedFromDb:v=>{loaded=v},setItems:()=>{},loadQuoteItems:async()=>{if(failure)throw Error('offline');return [{name:'saved'}]},hydrateQuoteItemProductLinks:async x=>x,normalizeLegacyQuoteItemProductId:x=>x,mapInputToQuotationItem:x=>x,toast:{error:()=>{message=true}},console:{warn:()=>{}},useEffect:fn=>{callback=fn}};
 vm.runInNewContext(compile(effect),sandbox);callback();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(loaded,!failure);
 assert.equal(message,failure);
}
console.log('Dimension round-trip and failed/successful item-load checks passed');
