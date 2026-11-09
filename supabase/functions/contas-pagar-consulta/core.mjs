export const VIEWS = ['resumo','lancamentos','agenda','dre','razao','caixa','conciliacao','auditoria'];
export const COMPANY_CODES = ['RECIFE','MADALENA','JABOATAO','ITAPISSUMA','COHAB','CAMARAGIBE','NANDONET','PABLOM'];
export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status=status; this.code=code; }
}
const day = value => {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const d=new Date(value+'T12:00:00Z');
  return Number.isFinite(+d)&&d.toISOString().slice(0,10)===value?d:null;
};
export function normalizeRequest(body) {
  if(!body||typeof body!=='object'||Array.isArray(body))throw new ApiError(400,'FILTROS','Filtros invalidos.');
  const permitted=['view','de','ate','empresa','pagina','status','regime'];
  if(Object.keys(body).some(k=>!permitted.includes(k)))throw new ApiError(400,'FILTROS','Parametro nao permitido.');
  const view=body.view||'resumo',de=day(body.de),ate=day(body.ate);
  if(!VIEWS.includes(view)||!de||!ate||body.de<'2026-01-01'||ate<de||(+ate-+de)/86400000>366)
    throw new ApiError(400,'PERIODO','Selecione um periodo valido, de 2026 em diante, com ate 367 dias.');
  const empresa=body.empresa||null;
  if(empresa!==null&&(typeof empresa!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(empresa)))
    throw new ApiError(400,'EMPRESA','Empresa invalida.');
  const pagina=body.pagina??1;
  if(!Number.isInteger(pagina)||pagina<1||pagina>10000)throw new ApiError(400,'PAGINA','Pagina invalida.');
  const status=body.status||'todos',regime=body.regime||'competencia';
  if(!['todos','PAGO','PROVISIONADO'].includes(status)||!['competencia','caixa'].includes(regime))
    throw new ApiError(400,'FILTROS','Filtro nao permitido.');
  return {view,de:body.de,ate:body.ate,empresa,pagina,status,regime,limite:50,offset:(pagina-1)*50};
}
export function canRead(user, registration) {
  return !!user?.id&&!!user?.email&&registration?.auth_user_id===user.id&&registration?.status==='ativo'&&registration?.allowed===true;
}
export function errorResponse(error) {
  if(error instanceof ApiError)return {status:error.status,body:{ok:false,code:error.code,erro:error.message}};
  return {status:503,body:{ok:false,code:'FONTE_INDISPONIVEL',erro:'A fonte financeira nao respondeu. Nenhum valor foi atualizado.'}};
}
export async function readData(sql,p) {
  const scope=sql`e.codigo in ${sql(COMPANY_CODES)} and (${p.empresa}::uuid is null or e.id=${p.empresa}::uuid)`;
  const fromLanc=sql`public.lancamentos l join public.empresas e on e.id=l.empresa_id`;
  const validDate=sql`(e.codigo not in ('NANDONET','PABLOM') or l.data_competencia >= date '2026-09-01')`;
  const date=p.view==='agenda'?sql`l.data_vencimento`:p.regime==='caixa'?sql`l.data_pagamento`:sql`l.data_competencia`;
  const filters=sql`${scope} and l.tipo='DESPESA' and ${validDate} and ${date} between ${p.de}::date and ${p.ate}::date
    and l.status not in ('CANCELADO','ESTORNADO')
    and (${p.status}='todos' or l.status=${p.status}) ${p.regime==='caixa'&&p.view!=='agenda'?sql`and l.status='PAGO'`:sql``}`;
  const page=sql`limit ${p.limite} offset ${p.offset}`;
  if(p.view==='resumo'){
    const [r]=await sql`select count(*) registros,sum(l.valor_previsto) previsto,
      sum(l.valor_realizado) filter(where l.status='PAGO') realizado,
      count(*) filter(where l.conta_codigo is null or btrim(l.conta_codigo)='') sem_classificacao,
      count(*) filter(where coalesce(l.valor_realizado,0)<>0 and l.data_pagamento is null) realizado_sem_data
      from ${fromLanc} where ${filters}`;
    return {resumo:r,rows:[],total:0};
  }
  if(p.view==='lancamentos'||p.view==='agenda'){
    const only=p.view==='agenda'?sql`and l.status='PROVISIONADO'`:sql``;
    const [n]=await sql`select count(*) total from ${fromLanc} where ${filters} ${only}`;
    const rows=await sql`select l.id,e.codigo filial,l.descricao,l.data_competencia,l.data_vencimento,l.data_pagamento,
      l.conta_codigo,l.status,l.valor_previsto,l.valor_realizado,l.pago_por,l.liquidacao,l.importado_de origem
      from ${fromLanc} where ${filters} ${only} order by ${date},l.id ${page}`;
    return {rows,total:Number(n.total)};
  }
  if(p.view==='dre'){
    const rows=await sql`select coalesce(nullif(pc.dre_linha,''),'SEM CLASSIFICACAO DRE') grupo,
      count(*) registros,sum(l.valor_previsto) previsto,sum(l.valor_realizado) filter(where l.status='PAGO') realizado
      from ${fromLanc} left join public.plano_contas pc on pc.codigo=l.conta_codigo
      where ${filters} group by 1 order by 1`;
    return {rows,total:rows.length,parcial:true};
  }
  if(p.view==='razao'){
    const where=sql`${scope} and c.data_lancamento between ${p.de}::date and ${p.ate}::date
      and c.status='EFETIVADO' and (e.codigo not in ('NANDONET','PABLOM') or c.data_lancamento>=date '2026-09-01')`;
    const from=sql`public.lancamentos_contabeis c join public.empresas e on e.id=c.empresa_id
      join public.lancamentos_contabeis_itens i on i.lancamento_id=c.id`;
    const [n]=await sql`select count(*) total from ${from} where ${where}`;
    const rows=await sql`select c.id,e.codigo filial,c.data_lancamento,c.numero,c.historico,c.status,c.origem,
      i.conta_codigo,i.lado,i.valor,i.historico_item from ${from} where ${where}
      order by c.data_lancamento,c.numero,c.id,i.ordem,i.id ${page}`;
    return {rows,total:Number(n.total)};
  }
  if(p.view==='caixa'||p.view==='conciliacao'){
    const where=sql`${scope} and x.data_transacao between ${p.de}::date and ${p.ate}::date
      and (e.codigo not in ('NANDONET','PABLOM') or x.data_transacao>=date '2026-09-01')`;
    const from=sql`public.extrato_bancario x join public.empresas e on e.id=x.empresa_id
      left join public.contas_bancarias c on c.id=x.conta_banco_id left join public.empresas ec on ec.id=c.empresa_id`;
    const [n]=await sql`select count(*) total from ${from} where ${where}`;
    const rows=await sql`select x.id,e.codigo filial,x.data_transacao,x.descricao_banco,x.valor,x.tipo_movimento,
      x.status_conc,x.lancamento_id,x.origem_arquivo,ec.codigo filial_conta,
      case when x.conta_banco_id is null then 'CONTA NAO IDENTIFICADA'
      when c.id is null then 'CONTA SEM CADASTRO' when c.empresa_id<>x.empresa_id then 'CONFERIR FILIAL DA CONTA' else null end alerta
      from ${from} where ${where} order by x.data_transacao,x.id ${page}`;
    return {rows,total:Number(n.total),saldo_validado:null};
  }
  // Findings are candidates, not corrections or proved accounting errors.
  const rows=await sql`select l.id,e.codigo filial,l.descricao,l.data_competencia,l.data_pagamento,l.status,
    l.conta_codigo,l.valor_realizado,l.importado_de origem,
    concat_ws('; ',case when l.conta_codigo is null or btrim(l.conta_codigo)='' then 'Sem classificacao contabil' end,
      case when coalesce(l.valor_realizado,0)<>0 and l.data_pagamento is null then 'Valor realizado sem data de pagamento' end,
      case when l.status='PAGO' and coalesce(l.valor_realizado,0)=0 then 'Pago com valor nulo ou zero: conferir' end) alerta
    from ${fromLanc} where ${scope} and ${validDate} and l.tipo='DESPESA'
    and l.data_competencia between ${p.de}::date and ${p.ate}::date
    and l.status not in ('CANCELADO','ESTORNADO')
    and (l.conta_codigo is null or btrim(l.conta_codigo)='' or
      (coalesce(l.valor_realizado,0)<>0 and l.data_pagamento is null) or
      (l.status='PAGO' and coalesce(l.valor_realizado,0)=0))
    order by l.data_competencia,l.id limit ${p.limite+1} offset ${p.offset}`;
  return {rows:rows.slice(0,p.limite),total:null,mais:rows.length>p.limite};
}

export async function readCoverage(sql,empresa) {
  return await sql`select e.id,e.codigo,e.razao_social,
    (select min(data_transacao) from public.extrato_bancario x where x.empresa_id=e.id and data_transacao>=date '2026-01-01') extrato_de,
    (select max(data_transacao) from public.extrato_bancario x where x.empresa_id=e.id and data_transacao>=date '2026-01-01') extrato_ate,
    (select max(data_competencia) from public.lancamentos l where l.empresa_id=e.id and l.data_competencia>=date '2026-01-01') competencia_ate
    from public.empresas e where e.codigo in ${sql(COMPANY_CODES)}
    and (${empresa}::uuid is null or e.id=${empresa}::uuid) order by e.codigo`;
}
