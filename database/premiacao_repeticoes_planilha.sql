-- Read-only audit. A repeated client or a PAGO label is not proof of a duplicate bank payment.
create function radar_auditoria.radar_premiacao_repeticoes()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Login necessario' using errcode='42501'; end if;
  if public.radar_perfil() not in ('admin','lider') then raise exception 'Acesso restrito' using errcode='42501'; end if;
  return (
    with linhas as materialized (
      select p.*, upper(trim(p.servico)) as servico_normalizado,
        upper(trim(coalesce(p.pago,'')))='PAGO' as marcado_pago
      from ixc.premiacao_planilha p
      where p.id_cliente>0 and p.competencia is not null
        and upper(trim(p.servico)) in ('INSTALACAO','ATIVACAO','REATIVACAO','UPGRADE','DOWNGRADE','RETENCAO','REVERSAO')
    ), servicos as (
      select id_cliente,servico_normalizado,count(distinct competencia) filter(where marcado_pago) as meses_pagos
      from linhas group by id_cliente,servico_normalizado
    ), grupos as (
      select l.id_cliente, max(nullif(trim(l.cliente),'')) as cliente,
        count(distinct l.competencia) as meses,
        count(distinct l.competencia) filter(where l.marcado_pago) as meses_marcados_pagos,
        exists(select 1 from servicos s where s.id_cliente=l.id_cliente and s.meses_pagos>1) as mesmo_servico_pago,
        string_agg(distinct to_char(l.competencia,'YYYY-MM'),', ' order by to_char(l.competencia,'YYYY-MM')) as competencias,
        jsonb_agg(jsonb_build_object('competencia',l.competencia,'colaborador',l.colaborador,
          'servico',l.servico,'filial',l.filial,'pago',l.pago,'aba',l.aba,'linha',l.linha,
          'valor_importado',l.valor_receber) order by l.competencia,l.aba,l.linha) as lancamentos
      from linhas l group by l.id_cliente having count(distinct l.competencia)>1
    )
    select jsonb_build_object(
      'planilha_lida_em',(select max(carregado_em) from ixc.premiacao_planilha),
      'competencia_inicial',(select min(competencia) from linhas),
      'competencia_final',(select max(competencia) from linhas),
      'clientes_repetidos',(select count(*) from grupos),
      'mesmo_servico_pago',(select count(*) from grupos where mesmo_servico_pago),
      'grupos',coalesce((select jsonb_agg(to_jsonb(g) order by g.mesmo_servico_pago desc,g.meses_marcados_pagos desc,g.id_cliente) from grupos g),'[]'::jsonb)
    )
  );
end $$;
revoke all on function radar_auditoria.radar_premiacao_repeticoes() from public,anon;
grant execute on function radar_auditoria.radar_premiacao_repeticoes() to authenticated;

create function public.radar_premiacao_repeticoes()
returns jsonb language sql stable security invoker set search_path='' as $$
  select radar_auditoria.radar_premiacao_repeticoes();
$$;
revoke all on function public.radar_premiacao_repeticoes() from public,anon;
grant execute on function public.radar_premiacao_repeticoes() to authenticated;
