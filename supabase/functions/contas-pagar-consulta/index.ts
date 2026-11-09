import postgres from 'npm:postgres@3.4.4';
import { ApiError, normalizeRequest, canRead, errorResponse, readData, readCoverage } from './core.mjs';

const origins = new Set(['https://claricepc.github.io','https://hilink.com.br','https://www.hilink.com.br']);
const connection = (url: string) => postgres(url,{ssl:'require',prepare:false,max:1,connect_timeout:10,idle_timeout:5});
const radar = connection(Deno.env.get('SUPABASE_DB_URL') || '');

Deno.serve(async (req: Request) => {
  const origin=req.headers.get('origin') || '';
  const headers: Record<string,string> = {'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
  if(origins.has(origin))headers['Access-Control-Allow-Origin']=origin;
  headers['Access-Control-Allow-Headers']='authorization, apikey, content-type, x-client-info';
  headers['Access-Control-Allow-Methods']='POST, OPTIONS';
  const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
  if(origin&&!origins.has(origin))return reply(403,{ok:false,erro:'Origem nao autorizada.'});
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply(405,{ok:false,erro:'Metodo nao permitido.'});
  let source: ReturnType<typeof connection> | undefined;
  let phase='auth';
  try {
    const token=req.headers.get('authorization')||'';
    if(!/^Bearer \S+$/.test(token))throw new ApiError(401,'SESSAO','Entre novamente no Radar.');
    const auth=await fetch(Deno.env.get('SUPABASE_URL')+'/auth/v1/user',{
      headers:{Authorization:token,apikey:Deno.env.get('SUPABASE_ANON_KEY')||''},signal:AbortSignal.timeout(10000)
    });
    if(!auth.ok)throw new ApiError(401,'SESSAO','Sessao expirada. Entre novamente.');
    const user=await auth.json();
    phase='authorization';
    const [reg]=await radar`select u.auth_user_id,u.status,exists(select 1 from fin.acesso a
      where lower(a.email)=lower(u.email)) allowed from public.radar_usuarios u
      where u.auth_user_id=${user.id}::uuid and lower(u.email)=lower(${user.email}) limit 1`;
    if(!canRead(user,reg))throw new ApiError(403,'ACESSO','Consulta restrita a gestao autorizada e ativa.');
    const raw=await req.text();
    if(raw.length>4096)throw new ApiError(400,'FILTROS','Solicitacao muito extensa.');
    let body;
    try{body=JSON.parse(raw);}catch{throw new ApiError(400,'FILTROS','Filtros invalidos.');}
    const p=normalizeRequest(body);
    phase='vault';
    const [secret]=await radar`select decrypted_secret from vault.decrypted_secrets where name='cp_financeiro_readonly_url' limit 1`;
    if(!secret?.decrypted_secret)throw new ApiError(503,'CONFIGURACAO','Conexao financeira ainda nao configurada.');
    source=connection(secret.decrypted_secret);
    phase='source';
    const result: any=await source.begin('read only',async sql=>{
      await sql`set local statement_timeout='12000ms'`;
      const [role]=await sql`select current_user nome,rolsuper,rolbypassrls,
        pg_has_role(current_user,'radar_cp_reader','member') permitido from pg_roles where rolname=current_user`;
      if(!role?.permitido||role.rolsuper||role.rolbypassrls||role.nome!=='radar_cp_consulta')
        throw new ApiError(503,'CONFIGURACAO','A conexao deve usar o acesso exclusivo de leitura.');
      const empresas=await readCoverage(sql,null);
      if(p.empresa&&!empresas.some(e=>e.id===p.empresa))throw new ApiError(403,'EMPRESA','Empresa fora do escopo autorizado.');
      return {...await readData(sql,p),empresas};
    });
    if(p.view==='auditoria'){
      phase='findings';
      const codigo=result.empresas.find(e=>e.id===p.empresa)?.codigo;
      const aliases=codigo==='COHAB'?['COHAB','IG','IBURA']:codigo==='ITAPISSUMA'?['ITAPISSUMA','IGARASSU']:codigo?[codigo]:null;
      result.registrados=await radar`select id,rodada,competencia,filial,teste,linha,valor_lancado,valor_correto,
        diferenca,fonte,status,observacao from fin.auditoria_achados
        where competencia between ${p.de.slice(0,7)} and ${p.ate.slice(0,7)}
        and (${aliases===null} or filial in ${radar(aliases||[''])} or filial='TODAS')
        order by competencia,filial,id limit 100`;
      result.registrados_limitados=result.registrados.length===100;
    }
    return reply(200,{ok:true,...result,filtros:p,fonte:'Financeiro existente',consultado_em:new Date().toISOString(),
      avisos:['Consulta apenas: nenhum lancamento foi alterado.','Saldo bancario e fechamento nao validados por esta consulta.']});
  }catch(error){
    const code=error instanceof ApiError?error.code:typeof error?.code==='string'&&/^[A-Z0-9_]{2,32}$/.test(error.code)?error.code:'UNAVAILABLE';
    console.error('[CP consulta]',phase,code);
    const r=errorResponse(error);
    return reply(r.status,r.body);
  }finally{if(source)await source.end({timeout:1}).catch(()=>{});}
});
