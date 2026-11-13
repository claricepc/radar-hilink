-- Pagamento conferido no extrato da filial que pagou (13/11/2026)
-- A observacao da planilha ("pago por Jaboatao", "pago pela IG") diz de qual conta saiu o dinheiro.
-- O Radar procura primeiro no extrato da filial pagadora; se nao achar o valor exato, procura em todas as contas;
-- se ainda nao achar, mostra a saida mais parecida (mesmo periodo, palavra da descricao no historico do banco).
create index if not exists extrato_mov_conta_data on fin.extrato_mov (conta, data);
create index if not exists extrato_mov_valor_data on fin.extrato_mov (valor, data);

create or replace function fin.filial_pagadora(p_info text, p_filial text) returns text
language sql immutable as $$
  select coalesce(case
    when upper(p_info) ~ 'PAG[OA] (POR|PELA|PELO|NO|NA|DA|DO) (A |O )?JABOAT' then 'JABOATAO'
    when upper(p_info) ~ 'PAG[OA] (POR|PELA|PELO|NO|NA|DA|DO) (A |O )?ITAPISSUMA' then 'ITAPISSUMA'
    when upper(p_info) ~ 'PAG[OA] (POR|PELA|PELO|NO|NA|DA|DO) (A |O )?MADALENA' then 'MADALENA'
    when upper(p_info) ~ 'PAG[OA] (POR|PELA|PELO|NO|NA|DA|DO) (A |O )?RECIFE' then 'RECIFE'
    when upper(p_info) ~ 'PAG[OA] (POR|PELA|PELO|NO|NA|DA|DO) (A |O )?(IG|IBURA|COHAB|IGARASSU)\M' then 'IG'
  end, p_filial)
$$;

create or replace view fin.planilha_banco as
select l.filial, l.competencia, l.linha,
       m.id extrato_id, m.data data_banco, m.valor valor_banco, m.historico, m.conta, m.candidatos,
       m.conta_filial, fin.filial_pagadora(l.info, l.filial) pagadora,
       a.data aprox_data, a.valor aprox_valor, a.historico aprox_historico, a.conta_filial aprox_filial
from fin.planilha_linha l
cross join lateral (select fin.filial_pagadora(l.info, l.filial) pag,
                           coalesce(l.data_vencimento, l.competencia) - 10 ini,
                           coalesce(l.data_vencimento, (l.competencia + interval '1 month')::date) + 20 fim,
                           coalesce(l.realizado, l.previsto) val) p
left join lateral (
  select e.id, e.data, e.valor, e.historico, e.conta, c.filial conta_filial, count(*) over () candidatos
  from fin.extrato_mov e join fin.conta_bancaria c on c.conta = e.conta
  where e.valor between -p.val - 0.05 and -p.val + 0.05 and e.data between p.ini and p.fim
    and (c.filial in (p.pag, l.filial) or (p.val >= 1000 and exists (
          select 1 from regexp_split_to_table(fin.norm_desc(l.descricao), '\s+') w
          where length(w) >= 5 and w not in ('PAGAMENTO','BOLETO','MENSAL','PARCELA','REFERENTE','SERVICO','SERVICOS','HILINK','COMPRA','DESPESA','DESPESAS','BANCOS','OUTROS','ENVIADO','BAIXA','COBRANCA','RECEBIDO','TRANSF') and upper(e.historico) like '%' || w || '%')))
  order by (c.filial <> p.pag), (c.filial <> l.filial), abs(e.data - coalesce(l.data_vencimento, l.competencia)), e.id
  limit 1) m on true
left join lateral (
  select e.data, e.valor, e.historico, c.filial conta_filial
  from fin.conta_bancaria c join fin.extrato_mov e on e.conta = c.conta
  where m.id is null and c.filial in (p.pag, l.filial) and e.data between p.ini and p.fim
    and e.valor between -p.val * 1.3 and -p.val * 0.7
    and exists (select 1 from regexp_split_to_table(fin.norm_desc(l.descricao), '\s+') w
                where length(w) >= 5 and w not in ('PAGAMENTO','BOLETO','MENSAL','PARCELA','REFERENTE','SERVICO','SERVICOS','HILINK','COMPRA','DESPESA','DESPESAS','BANCOS','OUTROS','ENVIADO','BAIXA','COBRANCA','RECEBIDO','TRANSF')
                  and upper(e.historico) like '%' || w || '%')
  order by abs(abs(e.valor) - p.val), abs(e.data - coalesce(l.data_vencimento, l.competencia))
  limit 1) a on true
where l.bloco = 'saida' and coalesce(l.realizado, l.previsto, 0) > 0 and (m.id is not null or a.data is not null);

-- Agenda: devolve de qual filial saiu o dinheiro e a saida parecida quando o valor difere
create or replace function public.radar_cp_planilhas(p_de date default null, p_ate date default null)
returns jsonb language plpgsql stable security definer set search_path = fin, public, pg_temp as $$
declare v_de date := coalesce(p_de, date_trunc('month', current_date)::date - 31);
        v_ate date := coalesce(p_ate, current_date + 30);
begin
  perform fin.exigir_acesso();
  return jsonb_build_object(
    'hoje', current_date,
    'leituras', (select coalesce(jsonb_agg(x order by x->>'filial'), '[]'::jsonb) from (
        select jsonb_build_object('filial', f.filial, 'ativo', f.ativo,
          'ultima', (select to_jsonb(l) - 'id' from fin.planilha_leitura l where l.filial = f.filial order by l.em desc limit 1),
          'ultima_ok', (select max(em) from fin.planilha_leitura l where l.filial = f.filial and l.ok),
          'extrato_ate', (select max(e.data) from fin.extrato_mov e join fin.conta_bancaria c on c.conta=e.conta where c.filial = f.filial)) x
        from fin.planilha_fonte f) s),
    'extrato_ate', (select coalesce(jsonb_object_agg(filial, ate), '{}'::jsonb) from (select c.filial, max(e.data) ate from fin.extrato_mov e join fin.conta_bancaria c on c.conta=e.conta group by 1) z),
    'agenda', (select coalesce(jsonb_agg(to_jsonb(p) order by p.data_vencimento, p.filial, p.linha), '[]'::jsonb)
        from (select l.filial, l.competencia, l.linha, l.aba, l.secao, l.descricao, l.venc_dia, l.data_vencimento, l.previsto, l.previsto_txt, l.info,
                     b.data_banco, b.valor_banco, b.historico banco_historico, b.candidatos banco_candidatos,
                     b.conta_filial banco_filial, fin.filial_pagadora(l.info, l.filial) pagadora,
                     b.aprox_data, b.aprox_valor, b.aprox_historico, b.aprox_filial
              from fin.planilha_linha l
              left join fin.planilha_banco b on b.filial=l.filial and b.competencia=l.competencia and b.linha=l.linha
              where l.bloco = 'saida' and l.realizado is null and coalesce(l.previsto,0) > 0
                and l.data_vencimento between v_de and v_ate) p),
    'meses', (select coalesce(jsonb_agg(to_jsonb(m) order by m.competencia desc, m.filial), '[]'::jsonb)
        from (select filial, competencia,
                count(*) filter (where bloco='saida') itens,
                sum(previsto) filter (where bloco='saida') previsto,
                sum(realizado) filter (where bloco='saida') realizado,
                sum(previsto) filter (where bloco='saida' and realizado is null) em_aberto,
                count(*) filter (where bloco='saida' and realizado is null and coalesce(previsto,0)>0 and data_vencimento < current_date) atrasados
              from fin.planilha_linha group by 1,2) m)
  );
end $$;

-- Conferencia no extrato (usada pela auditoria semanal e por consulta): linhas que o banco contradiz.
-- Rateio: cada filial lanca a sua parte e a pagadora paga o total; confere a soma das partes com uma saida da pagadora.
create or replace function fin.conferencia_extrato(p_desde date)
returns table (filial text, competencia date, linha int, descricao text, previsto numeric, realizado numeric, info text,
               teste text, pagadora text, banco_filial text, banco_data date, banco_valor numeric, banco_historico text)
language sql stable security definer set search_path = fin, public, pg_temp as $$
  with x as (
    select l.*, fin.filial_pagadora(l.info, l.filial) pag, upper(coalesce(l.info,'')) ~ 'RATEI|RATEAD' rateio,
           b.conta_filial, b.data_banco, b.valor_banco, b.historico,
           b.aprox_filial, b.aprox_data, b.aprox_valor, b.aprox_historico,
           coalesce(l.data_vencimento, l.competencia) - 10 ini, coalesce(l.data_vencimento, (l.competencia + interval '1 month')::date) + 20 fim
    from fin.planilha_linha l left join fin.planilha_banco b on b.filial=l.filial and b.competencia=l.competencia and b.linha=l.linha
    where l.bloco='saida' and l.competencia >= p_desde and coalesce(l.realizado, l.previsto, 0) > 0),
  cob as ( -- tem extrato da pagadora em pelo menos 3 dias da janela
    select x.filial, x.competencia, x.linha,
           (select count(distinct e.data) from fin.extrato_mov e join fin.conta_bancaria c on c.conta = e.conta
             where c.filial = x.pag and e.data between x.ini and x.fim) >= 3 tem
    from x),
  rat as ( -- grupos de rateio: mesma descricao, mes e pagadora; total = partes das outras filiais + parte da propria pagadora
    select o.dn, o.competencia, o.pag,
           o.soma + coalesce((select sum(coalesce(y.realizado, y.previsto)) from x y
                              where y.filial = o.pag and fin.norm_desc(y.descricao) = o.dn and y.competencia = o.competencia), 0) total,
           o.ini, o.fim, o.partes + (select count(*) from x y where y.filial = o.pag and fin.norm_desc(y.descricao) = o.dn and y.competencia = o.competencia) partes
    from (select fin.norm_desc(x.descricao) dn, x.competencia, x.pag, sum(coalesce(x.realizado, x.previsto)) soma,
                 min(x.ini) ini, max(x.fim) fim, count(*) partes
          from x where x.rateio and x.pag <> x.filial group by 1,2,3) o),
  ratok as (
    select r.*, (select e.data from fin.extrato_mov e join fin.conta_bancaria c on c.conta = e.conta
                  where c.filial = r.pag and e.data between r.ini and r.fim and e.valor between -r.total - 0.10 and -r.total + 0.10 limit 1) data_total
    from rat r)
  select x.filial, x.competencia, x.linha, x.descricao, x.previsto, x.realizado, x.info, 'valor diferente no banco', x.pag, x.aprox_filial, x.aprox_data, x.aprox_valor, x.aprox_historico
    from x where not x.rateio and x.data_banco is null and x.aprox_data is not null
  union all
  select x.filial, x.competencia, x.linha, x.descricao, x.previsto, x.realizado, x.info, 'saiu de outra conta', x.pag, x.conta_filial, x.data_banco, x.valor_banco, x.historico
    from x where not x.rateio and x.data_banco is not null and x.conta_filial <> x.pag
  union all
  select x.filial, x.competencia, x.linha, x.descricao, x.previsto, x.realizado, x.info, 'pago por outra filial sem saida no banco', x.pag, null, null, null, null
    from x join cob on cob.filial = x.filial and cob.competencia = x.competencia and cob.linha = x.linha
    where not x.rateio and x.pag <> x.filial and x.data_banco is null and x.aprox_data is null and cob.tem
  union all
  select x.filial, x.competencia, x.linha, x.descricao, x.previsto, x.realizado, x.info,
         'rateio: soma das partes nao bate com a saida do banco', x.pag, null, null, r.total, r.partes || ' partes somam ' || r.total
    from x join ratok r on r.dn = fin.norm_desc(x.descricao) and r.competencia = x.competencia and r.pag = x.pag
    join cob on cob.filial = x.filial and cob.competencia = x.competencia and cob.linha = x.linha
    where x.rateio and x.pag <> x.filial and r.data_total is null and cob.tem
$$;
revoke all on function fin.conferencia_extrato(date) from public, anon, authenticated;

-- Auditoria semanal: teste 4 passa a ser a conferencia no extrato (aplicado por troca do trecho -- 4) em fin.auditoria_semanal)
-- ver migration auditoria_conferencia_extrato no Supabase (13/11/2026).
