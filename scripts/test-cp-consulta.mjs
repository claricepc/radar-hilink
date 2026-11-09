import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {normalizeRequest,canRead,errorResponse,readData,readCoverage,VIEWS} from '../supabase/functions/contas-pagar-consulta/core.mjs';

const base={de:'2026-10-01',ate:'2026-10-31'};
assert.equal(normalizeRequest(base).limite,50);
for(const bad of [{de:'2025-12-31'},{de:'2026-02-30'},{ate:'2026-01-01'},{pagina:0},{pagina:1.5},{empresa:"';delete"},{status:'DELETE'},{view:'sql'},{regime:'x'},{sql:'drop table'},{ate:'2028-01-01'}]){
  assert.throws(()=>normalizeRequest({...base,...bad}));
}
const user={id:'abc',email:'x@example.com'},reg={auth_user_id:'abc',status:'ativo',allowed:true};
assert.equal(canRead(user,reg),true);
for(const change of [{status:'inativo'},{auth_user_id:'other'},{allowed:false}])assert.equal(canRead(user,{...reg,...change}),false);
assert.equal(canRead(null,reg),false);
assert.ok(!JSON.stringify(errorResponse(new Error('password=SECRET'))).includes('SECRET'));

// Render only parameter-bound SQL for EXPLAIN. No database connection or real rows.
const queries=[];
const literal=v=>v===null?'NULL':typeof v==='boolean'?String(v):typeof v==='number'?String(v):"'"+String(v).replaceAll("'","''")+"'";
const sql=(strings,...values)=>{
  if(!Object.hasOwn(strings,'raw'))return {text:'('+strings.map(literal).join(',')+')'};
  const text=strings.reduce((s,x,i)=>s+x+(i<values.length?(values[i]?.text??literal(values[i])):''),'');
  return {text,then(resolve,reject){queries.push(text);return Promise.resolve(/count\(\*\) total/.test(text)?[{total:0}]:/select count\(\*\) registros/.test(text)?[{registros:0}]:[]).then(resolve,reject);}};
};
for(const view of VIEWS)await readData(sql,normalizeRequest({...base,view}));
await readData(sql,normalizeRequest({...base,view:'agenda',regime:'caixa'}));
await readData(sql,normalizeRequest({...base,view:'resumo',regime:'caixa'}));
await readCoverage(sql,null);
assert.ok(queries.some(q=>q.includes('l.data_vencimento between')));
assert.ok(queries.some(q=>q.includes('l.data_pagamento between')));
assert.ok(!queries.filter(q=>q.includes('l.data_vencimento between')).some(q=>q.includes("and l.status='PAGO'")));
assert.ok(queries.every(q=>!/(insert into|update |delete from|drop table)/i.test(q)));
fs.mkdirSync('qa-cp',{recursive:true});
fs.writeFileSync('qa-cp/explain.sql',queries.map(q=>'EXPLAIN (FORMAT JSON) '+q+';').join('\n'));

const current=fs.readFileSync('RADAR_HILINK.html','utf8');
const before=execFileSync('git',['show','HEAD:RADAR_HILINK.html'],{encoding:'utf8',maxBuffer:8e6});
const modules=s=>[...s.matchAll(/id="mod-([^"]+)"/g)].map(x=>x[1]);
for(const id of modules(before))assert.ok(modules(current).includes(id),'Removed module '+id);
assert.equal(modules(current).filter(x=>x==='cp').length,1);
let scripts=0;
for(const match of current.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)){new vm.Script(match[1]);scripts++;}
new vm.Script(fs.readFileSync('contas-pagar.js','utf8'));
console.log(JSON.stringify({ok:true,views:VIEWS.length,sqlQueries:queries.length,inlineScripts:scripts,preservedModules:modules(before).length}));
