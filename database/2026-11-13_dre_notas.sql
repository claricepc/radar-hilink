-- DRE: notas explicativas e pendencias por linha/conta (13/11/2026)
-- Nota: explica uma variacao (ex.: queda da tarifa apos acordo com o Santander).
-- Pendencia: algo a cobrar/resolver (ex.: estorno das tarifas indevidas). Fica sinalizada na DRE e vira tarefa
-- na agenda do responsavel; ao marcar resolvida (na DRE ou concluindo a tarefa), a sinalizacao sai.
create table if not exists fin.dre_nota (
  id bigint generated always as identity primary key,
  ano int not null,
  empresa text,                 -- null = vale para o consolidado e todas as empresas
  chave text not null,          -- 'linha:DESP_FINANC' ou 'conta:5.5.1.01'
  mes text,                     -- 'YYYY-MM' (opcional)
  texto text not null,
  pendencia boolean not null default false,
  responsavel text,             -- e-mail
  prazo date,
  tarefa_id uuid,
  resolvida_em timestamptz, resolvida_por text, resolucao text,
  autor text, criada_em timestamptz not null default now(),
  apagada_em timestamptz
);
create index if not exists dre_nota_ano on fin.dre_nota (ano, chave);
alter table fin.dre_nota enable row level security;

create or replace function public.radar_cp_dre_notas(p_ano int)
returns jsonb language plpgsql security definer set search_path = fin, public, pg_temp as $$
begin
  perform fin.exigir_acesso();
  -- tarefa concluida na agenda resolve a pendencia
  update fin.dre_nota n set resolvida_em = now(), resolvida_por = 'agenda', resolucao = coalesce(n.resolucao, 'Tarefa concluída na agenda')
  from radar_agenda.tarefas t where t.id = n.tarefa_id and n.pendencia and n.resolvida_em is null and t.status = 'concluida';
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'ano', ano, 'empresa', empresa, 'chave', chave, 'mes', mes, 'texto', texto,
      'pendencia', pendencia, 'responsavel', responsavel, 'prazo', prazo, 'resolvida_em', resolvida_em, 'resolvida_por', resolvida_por,
      'resolucao', resolucao, 'autor', autor, 'criada_em', criada_em) order by criada_em desc)
    from fin.dre_nota where ano = p_ano and apagada_em is null), '[]'::jsonb);
end $$;
grant execute on function public.radar_cp_dre_notas(int) to authenticated;

create or replace function public.radar_cp_dre_nota_salvar(p_ano int, p_empresa text, p_chave text, p_mes text, p_texto text,
  p_pendencia boolean default false, p_responsavel text default null, p_prazo date default null)
returns jsonb language plpgsql security definer set search_path = fin, public, pg_temp as $$
declare quem text := lower(nullif(current_setting('request.jwt.claims', true),'')::jsonb->>'email');
        v_id bigint; v_tarefa uuid; resp uuid; autor uuid; rot text;
begin
  perform fin.exigir_acesso();
  if coalesce(trim(p_texto),'') = '' then raise exception 'Escreva a nota'; end if;
  if p_chave !~ '^(linha|conta):' then raise exception 'chave invalida'; end if;
  insert into fin.dre_nota (ano, empresa, chave, mes, texto, pendencia, responsavel, prazo, autor)
  values (p_ano, nullif(p_empresa,''), p_chave, nullif(p_mes,''), trim(p_texto), coalesce(p_pendencia,false), lower(nullif(p_responsavel,'')), p_prazo, quem)
  returning id into v_id;
  if p_pendencia then
    select auth_user_id into resp from public.radar_usuarios where lower(email) = lower(coalesce(nullif(p_responsavel,''), quem));
    select auth_user_id into autor from public.radar_usuarios where lower(email) = quem;
    rot := case when p_chave like 'conta:%' then 'conta '||substr(p_chave,7)||coalesce(' '||(select descricao from fin.plano_contas where codigo = substr(p_chave,7)),'')
                else 'linha '||substr(p_chave,7) end;
    if resp is not null then
      insert into radar_agenda.tarefas (autor, responsavel, titulo, detalhes, prazo)
      values (coalesce(autor, resp), resp, left('DRE: '||trim(p_texto), 120),
              'Pendência registrada na DRE ('||rot||coalesce(', '||p_mes,'')||coalesce(', '||p_empresa,'')||E').\n\n'||trim(p_texto)||
              E'\n\nAo concluir esta tarefa, a sinalização sai da DRE.', coalesce(p_prazo, current_date + 7))
      returning id into v_tarefa;
      update fin.dre_nota set tarefa_id = v_tarefa where id = v_id;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'tarefa', v_tarefa);
end $$;
grant execute on function public.radar_cp_dre_nota_salvar(int,text,text,text,text,boolean,text,date) to authenticated;

create or replace function public.radar_cp_dre_nota_resolver(p_id bigint, p_resolvida boolean, p_resolucao text default null)
returns jsonb language plpgsql security definer set search_path = fin, public, pg_temp as $$
declare quem text := lower(nullif(current_setting('request.jwt.claims', true),'')::jsonb->>'email'); t uuid;
begin
  perform fin.exigir_acesso();
  update fin.dre_nota set resolvida_em = case when p_resolvida then now() end, resolvida_por = case when p_resolvida then quem end,
         resolucao = case when p_resolvida then nullif(trim(p_resolucao),'') end
  where id = p_id returning tarefa_id into t;
  if t is not null then
    update radar_agenda.tarefas set status = case when p_resolvida then 'concluida' else 'pendente' end where id = t;
  end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.radar_cp_dre_nota_resolver(bigint,boolean,text) to authenticated;

-- apagar = esconder (sem delete), so quem escreveu ou Clarice
create or replace function public.radar_cp_dre_nota_apagar(p_id bigint)
returns jsonb language plpgsql security definer set search_path = fin, public, pg_temp as $$
declare quem text := lower(nullif(current_setting('request.jwt.claims', true),'')::jsonb->>'email');
begin
  perform fin.exigir_acesso();
  update fin.dre_nota set apagada_em = now() where id = p_id and (autor = quem or quem = 'clarice@hilink.com.br');
  if not found then raise exception 'Só quem escreveu a nota pode apagar'; end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.radar_cp_dre_nota_apagar(bigint) to authenticated;

-- quem pode ser responsavel (quem tem acesso a Contas a pagar)
create or replace function public.radar_cp_pessoas()
returns jsonb language sql stable security definer set search_path = fin, public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('email', a.email, 'nome', coalesce(u.nome, split_part(a.email,'@',1))) order by u.nome), '[]'::jsonb)
  from fin.acesso a left join public.radar_usuarios u on lower(u.email) = lower(a.email) where public.radar_cp_pode()
$$;
grant execute on function public.radar_cp_pessoas() to authenticated;
