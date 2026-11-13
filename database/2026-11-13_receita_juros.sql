-- Receita do IXC separada: valor dos boletos, juros e multas recebidos e descontos dados no pagamento.
-- Fonte: movimentos financeiros do IXC (fn_movim_finan), já lidos pelo Radar. Em cada recebimento de título:
--   tipo_lanc R = valor do título; C = juros e multa cobrados no atraso; D = desconto concedido.
-- Conferido no título 2781276: valor 400,00, pago 408,52 em 02/01/2026 (vencia 29/12/2025) -> R 400,00 + C 8,52.
-- O IXC lança juros e multa juntos nesse movimento, por isso ficam numa linha só.

alter table ixc.receita_mensal add column if not exists mensalidades numeric(18,2);
alter table ixc.receita_mensal add column if not exists juros_multa numeric(18,2);
alter table ixc.receita_mensal add column if not exists descontos numeric(18,2);

create or replace function ixc.receita_gravar(p_carga uuid)
returns void language plpgsql security definer set search_path to 'pg_catalog', 'ixc', 'public' as $function$
declare c ixc.fat_cargas;
begin
  select * into strict c from ixc.fat_cargas where id = p_carga;
  create temp table if not exists _rec_novo(mes text, filial text, recebido numeric, recebimentos int, mensalidades numeric, juros_multa numeric, descontos numeric) on commit drop;
  truncate _rec_novo;
  insert into _rec_novo
  select to_char(p.dia,'YYYY-MM'), p.filial, round(sum(m.credito - m.debito), 2), count(distinct p.id),
         round(coalesce(sum(m.credito - m.debito) filter (where m.tipo = 'R'), 0), 2),
         round(coalesce(sum(m.credito - m.debito) filter (where m.tipo = 'C'), 0), 2),
         round(coalesce(sum(m.debito - m.credito) filter (where m.tipo = 'D'), 0), 2)
  from ixc.fat_movimentos m
  join ixc.fat_movimentos p on p.carga = m.carga and p.id = m.grupo and p.tipo = 'M'
  where m.carga = c.id and m.tipo <> 'M'
    and m.grupo in (select grupo from ixc.fat_movimentos where carga = c.id and tipo = 'R' and documento ~ '^[0-9]+$')
  group by 1, 2;
  -- meses do periodo que sumiram da leitura ficam zerados
  update ixc.receita_mensal r set recebido = 0, recebimentos = 0, mensalidades = 0, juros_multa = 0, descontos = 0
   where r.mes between to_char(c.de,'YYYY-MM') and to_char(c.ate,'YYYY-MM')
     and not exists (select 1 from _rec_novo n where n.mes = r.mes and n.filial = r.filial);
  insert into ixc.receita_mensal(mes, filial, recebido, recebimentos, mensalidades, juros_multa, descontos)
  select mes, filial, recebido, recebimentos, mensalidades, juros_multa, descontos from _rec_novo
  on conflict (mes, filial) do update set recebido = excluded.recebido, recebimentos = excluded.recebimentos,
    mensalidades = excluded.mensalidades, juros_multa = excluded.juros_multa, descontos = excluded.descontos;
  insert into ixc.receita_meta(id, de, ate, atualizado_em, carga, por)
  values (1, c.de, c.ate, now(), c.id, c.por)
  on conflict (id) do update set de = excluded.de, ate = excluded.ate, atualizado_em = excluded.atualizado_em, carga = excluded.carga, por = excluded.por;
end $function$;

-- recalcula com a última leitura já feita (não chama o IXC) e mantém a data da leitura original
do $$ declare v ixc.receita_meta; begin
  select * into v from ixc.receita_meta where id = 1;
  if v.carga is not null then
    perform ixc.receita_gravar(v.carga);
    update ixc.receita_meta set atualizado_em = v.atualizado_em where id = 1;
  end if;
end $$;

-- DRE: manda também a receita separada por mês
create or replace function public.radar_cp_dre(p_ano integer default null, p_empresa text default null)
returns jsonb language plpgsql stable security definer set search_path to 'fin', 'ixc', 'public', 'pg_temp' as $function$
declare v_ano int := coalesce(p_ano, extract(year from current_date)::int);
begin
  perform fin.exigir_acesso();
  return (
  with recf as (
    select to_date(r.mes||'-01','YYYY-MM-DD') comp, r.recebido, r.mensalidades, r.juros_multa, r.descontos
    from ixc.receita_mensal r join fin.filial_ixc_empresa f on f.filial_ixc = r.filial
    where left(r.mes,4)::int = v_ano and (f.desde is null or to_date(r.mes||'-01','YYYY-MM-DD') >= f.desde)
      and (p_empresa is null or f.empresa = p_empresa)),
  rec as (select comp, sum(recebido) valor, sum(mensalidades) mens, sum(juros_multa) juros, sum(descontos) descs from recf group by 1),
  des as (
    select c.competencia comp, coalesce(p.dre_linha,
             case when c.conta_codigo is null then 'A_CLASSIFICAR' when p.tipo in ('ATIVO','PASSIVO') then 'FORA_'||p.tipo else 'OUTRAS_DESP' end) linha,
           c.conta_codigo, p.descricao conta, sum(c.previsto) valor
    from fin.planilha_classificada c left join fin.plano_contas p on p.codigo = c.conta_codigo
    where c.bloco='saida' and c.previsto is not null and extract(year from c.competencia) = v_ano
      and (p_empresa is null or c.filial = p_empresa) and c.filial <> 'CAMARAGIBE'
    group by 1,2,3,4)
  select jsonb_build_object('ano', v_ano, 'empresa', coalesce(p_empresa,'CONSOLIDADO'),
    'meses', (select coalesce(jsonb_agg(distinct to_char(comp,'YYYY-MM')), '[]'::jsonb) from (select comp from rec union select comp from des) m),
    'receita', (select coalesce(jsonb_object_agg(to_char(comp,'YYYY-MM'), round(valor,2)), '{}'::jsonb) from rec),
    'receita_det', (select coalesce(jsonb_object_agg(to_char(comp,'YYYY-MM'), jsonb_build_object('mens', round(mens,2), 'juros', round(juros,2), 'desc', round(descs,2))), '{}'::jsonb) from rec where mens is not null),
    'linhas', (select coalesce(jsonb_agg(jsonb_build_object('linha', linha, 'conta_codigo', conta_codigo, 'conta', conta, 'mes', to_char(comp,'YYYY-MM'), 'valor', round(valor,2))), '[]'::jsonb) from des),
    'leitura_receita', (select atualizado_em from ixc.receita_meta where id=1),
    'receita_ate', (select ate from ixc.receita_meta where id=1)));
end $function$;
