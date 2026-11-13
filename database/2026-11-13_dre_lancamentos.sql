-- DRE: lancamentos (linhas das planilhas) que compoem um valor da DRE (conta ou linha, empresa, meses)
create or replace function public.radar_cp_dre_lancamentos(p_ano int, p_empresa text, p_conta text, p_linha text, p_meses text[])
returns jsonb language plpgsql stable security definer set search_path = fin, public, pg_temp as $$
begin
  perform fin.exigir_acesso();
  return (select coalesce(jsonb_agg(x order by x->>'competencia', (x->>'previsto')::numeric desc), '[]'::jsonb) from (
    select jsonb_build_object('filial', c.filial, 'competencia', to_char(c.competencia,'YYYY-MM'), 'aba', c.aba, 'linha', c.linha,
      'secao', c.secao, 'descricao', c.descricao, 'desc_norm', c.desc_norm, 'vencimento', c.data_vencimento,
      'previsto', c.previsto, 'realizado', c.realizado, 'info', c.info, 'conta_codigo', c.conta_codigo,
      'conta', p.descricao, 'origem', c.origem_classe) x
    from fin.planilha_classificada c left join fin.plano_contas p on p.codigo = c.conta_codigo
    where c.bloco = 'saida' and c.previsto is not null and extract(year from c.competencia) = coalesce(p_ano, extract(year from current_date)::int)
      and c.filial <> 'CAMARAGIBE' and (p_empresa is null or p_empresa = '' or c.filial = p_empresa)
      and (p_meses is null or to_char(c.competencia,'YYYY-MM') = any(p_meses))
      and (p_conta is null or coalesce(c.conta_codigo,'') = p_conta)
      and (p_linha is null or coalesce(p.dre_linha, case when c.conta_codigo is null then 'A_CLASSIFICAR' when p.tipo in ('ATIVO','PASSIVO') then 'FORA_'||p.tipo else 'OUTRAS_DESP' end) = p_linha)
    limit 3000) t);
end $$;
grant execute on function public.radar_cp_dre_lancamentos(int,text,text,text,text[]) to authenticated;
