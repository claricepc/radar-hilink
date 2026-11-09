import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
import * as core from '../supabase/functions/contas-pagar-consulta/core.mjs';

const src=stripTypeScriptTypes(fs.readFileSync('supabase/functions/contas-pagar-consulta/index.ts','utf8')
  .replace(/^import .*;\r?\n/gm,''));
let handler,mode='ok',vaultReads=0;
const radar=async strings=>{
  const q=strings.join('');
  if(q.includes('radar_usuarios'))return [{auth_user_id:mode==='uid'?'other':'u1',status:mode==='inactive'?'inativo':'ativo',allowed:mode!=='denied'}];
  if(q.includes('vault.decrypted_secrets')){vaultReads++;return mode==='unconfigured'?[]:[{decrypted_secret:'financial'}];}
  return [];
};
const source=()=>{};
source.end=async()=>{};
source.begin=async(option,fn)=>{
  assert.equal(option,'read only');
  return fn(async strings=>strings.join('').includes('pg_roles')?[{nome:mode==='admin'?'postgres':'radar_cp_consulta',permitido:true,rolsuper:mode==='admin',rolbypassrls:false}]:[]);
};
const context={...core,postgres:url=>url==='radar'?radar:source,
  readCoverage:async()=>[],readData:async()=>({rows:[],total:0}),
  Deno:{env:{get:key=>({SUPABASE_DB_URL:'radar',SUPABASE_URL:'https://test.invalid',SUPABASE_ANON_KEY:'PUBLIC'}[key])},serve:fn=>handler=fn},
  fetch:async()=>new Response(JSON.stringify({id:'u1',email:'x@example.com'}),{status:mode==='expired'?401:200}),
  Request,Response,AbortSignal,Set,JSON,Date};
vm.runInNewContext(src,context);
const request=(opts={})=>new Request('https://test.invalid/financial',{method:opts.method||'POST',headers:{origin:opts.origin||'https://claricepc.github.io',...(opts.auth===false?{}:{authorization:'Bearer TEST'})},...(opts.method==='OPTIONS'?{}:{body:opts.body||JSON.stringify({de:'2026-10-01',ate:'2026-10-31'})})});
assert.equal((await handler(request({method:'OPTIONS'}))).status,204);
assert.equal((await handler(request({origin:'https://evil.example'}))).status,403);
assert.equal((await handler(request({auth:false}))).status,401);
for(const [m,status] of [['expired',401],['inactive',403],['denied',403],['uid',403]]){
  mode=m;const before=vaultReads;const r=await handler(request());assert.equal(r.status,status,m);assert.equal(vaultReads,before,'Secret read before authorization');
}
mode='ok';assert.equal((await handler(request({body:'{'}))).status,400);
mode='unconfigured';assert.equal((await handler(request())).status,503);
mode='admin';assert.equal((await handler(request())).status,503);
mode='ok';const r=await handler(request());assert.equal(r.status,200);assert.equal((await r.json()).ok,true);
console.log(JSON.stringify({ok:true,securityCases:11,secretReadOnlyAfterAuthorization:true,readOnlyTransaction:true}));
