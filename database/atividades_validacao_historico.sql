-- Preserve existing tasks. Legacy closures keep their original dates and audit trail.
alter table ixc.atividades
  add column validacao_solicitada_em timestamptz,
  add column validacao_solicitada_por uuid,
  add column validacao_solicitada_por_nome text,
  add column validacao_resumo text,
  add column decisao_obs text,
  add column fechamento_resumo jsonb;
create index atividades_historico_encerramento_idx on ixc.atividades(encerrada_em desc,id desc) where status='encerrada';

create function radar_auditoria.radar_atv_transicao(p_atividade bigint,p_acao text,p_obs text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  a ixc.atividades%rowtype;
  perfil text := coalesce(public.radar_perfil(),'');
  motivo text := btrim(coalesce(p_obs,''));
  autor text;
  resumo jsonb;
begin
  if auth.uid() is null then raise exception 'Login necessario.' using errcode='42501'; end if;
  if p_acao is null or p_acao not in ('solicitar','devolver','concluir','cancelar') then raise exception 'Acao invalida.'; end if;
  if perfil not in ('admin','lider','atendente') then raise exception 'Sem permissao.' using errcode='42501'; end if;
  select * into a from ixc.atividades where id=p_atividade and removida_em is null for update;
  if not found then return jsonb_build_object('ok',false,'motivo','Atividade nao encontrada.'); end if;
  if perfil not in ('admin','lider') and (p_acao<>'solicitar' or a.responsavel is distinct from auth.uid()) then
    raise exception 'Somente a lideranca pode decidir; a atendente pode encaminhar sua propria tarefa.' using errcode='42501';
  end if;
  if a.status<>'aberta' then return jsonb_build_object('ok',false,'motivo','Esta atividade ja foi encerrada.'); end if;
  if motivo='' or length(motivo)>2000 then return jsonb_build_object('ok',false,'motivo','Informe o resumo ou a justificativa, com ate 2.000 caracteres.'); end if;
  if p_acao='solicitar' and a.validacao_solicitada_em is not null then
    return jsonb_build_object('ok',false,'motivo','A tarefa ja aguarda validacao da lideranca.');
  end if;
  if p_acao in ('devolver','concluir') and a.validacao_solicitada_em is null then
    return jsonb_build_object('ok',false,'motivo','Encaminhe a tarefa para validacao antes de decidir.');
  end if;
  autor := ixc.radar_nome_atual();
  if p_acao='solicitar' then
    update ixc.atividades set validacao_solicitada_em=now(),validacao_solicitada_por=auth.uid(),
      validacao_solicitada_por_nome=autor,validacao_resumo=motivo,decisao_obs=null where id=a.id;
  elsif p_acao='devolver' then
    update ixc.atividades set validacao_solicitada_em=null,validacao_solicitada_por=null,
      validacao_solicitada_por_nome=null,validacao_resumo=null,decisao_obs=motivo where id=a.id;
  else
    -- Fixed evidence at closure, independent of later payments or IXC changes.
    select jsonb_build_object(
      'capturado_em',now(),'total',count(*),
      'tratados',count(*) filter(where v.situacao not in ('pendente','aguardando') or v.resolvido_ixc),
      'pendentes',count(*) filter(where v.situacao='pendente' and not v.resolvido_ixc),
      'aguardando',count(*) filter(where v.situacao='aguardando' and not v.resolvido_ixc),
      'resolvidos_ixc',count(*) filter(where v.resolvido_ixc),
      'itens',coalesce(jsonb_agg(to_jsonb(it)||to_jsonb(v) order by v.id),'[]'::jsonb)
    ) into resumo from ixc.v_atividade_itens v join ixc.atividade_itens it on it.id=v.id where v.atividade_id=a.id;
    update ixc.atividades set status='encerrada',encerrada_em=now(),encerrada_por_nome=autor,
      decisao_obs=motivo,fechamento_resumo=resumo,
      removida_em=case when p_acao='cancelar' then now() end,
      removida_por_nome=case when p_acao='cancelar' then autor end where id=a.id;
  end if;
  insert into ixc.atividade_eventos(atividade_id,por,por_nome,acao,obs)
    values(a.id,auth.uid(),autor,case p_acao when 'solicitar' then 'solicitou validacao'
      when 'devolver' then 'devolveu para ajuste' when 'concluir' then 'concluiu' else 'cancelou' end,motivo);
  return jsonb_build_object('ok',true,'acao',p_acao);
end $$;
revoke all on function radar_auditoria.radar_atv_transicao(bigint,text,text) from public,anon;
grant execute on function radar_auditoria.radar_atv_transicao(bigint,text,text) to authenticated;
create function public.radar_atv_transicao(p_atividade bigint,p_acao text,p_obs text)
returns jsonb language sql security invoker set search_path='' as $$
  select radar_auditoria.radar_atv_transicao(p_atividade,p_acao,p_obs);
$$;
revoke all on function public.radar_atv_transicao(bigint,text,text) from public,anon;
grant execute on function public.radar_atv_transicao(bigint,text,text) to authenticated;

-- Block old clients from bypassing validation or cancelling without a reason.
create or replace function public.radar_atv_encerrar(p_atividade bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin raise exception 'Atualize o Radar e use o fluxo de validacao da lideranca.'; end $$;
create or replace function public.radar_atv_remover(p_atividade bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin raise exception 'Atualize o Radar e use Cancelar atividade, com justificativa.'; end $$;

-- Keep the existing listing and its calculations; expose the workflow metadata.
do $$ declare src text;
begin
  src := pg_get_functiondef('public.radar_atv_listar(integer)'::regprocedure);
  if position('''encerrada_em'', a.encerrada_em,' in src)=0 then raise exception 'Listagem mudou; revisar migracao.'; end if;
  src := replace(src,'''encerrada_em'', a.encerrada_em,',
    '''encerrada_em'', a.encerrada_em, ''validacao_solicitada_em'',a.validacao_solicitada_em,
     ''validacao_solicitada_por_nome'',a.validacao_solicitada_por_nome,''validacao_resumo'',a.validacao_resumo,''decisao_obs'',a.decisao_obs,');
  execute src;
end $$;

-- Freeze human work while under review or closed. IXC reconciliation fields remain writable.
create function radar_auditoria.radar_atv_proteger_itens()
returns trigger language plpgsql security definer set search_path='' as $$
declare a ixc.atividades%rowtype;
begin
  if tg_op='UPDATE' and row(new.situacao,new.obs,new.acoes,new.tratado_por,new.tratado_por_nome,new.tratado_em,
      new.tentativas,new.com_quem,new.com_quem_nome,new.pego_em)
    is not distinct from row(old.situacao,old.obs,old.acoes,old.tratado_por,old.tratado_por_nome,old.tratado_em,
      old.tentativas,old.com_quem,old.com_quem_nome,old.pego_em) then return new; end if;
  select * into a from ixc.atividades where id=new.atividade_id for share;
  if a.status<>'aberta' or a.removida_em is not null or a.validacao_solicitada_em is not null then
    raise exception 'Esta tarefa esta em validacao ou encerrada. A lideranca precisa devolver para ajuste.';
  end if;
  return new;
end $$;
revoke all on function radar_auditoria.radar_atv_proteger_itens() from public,anon,authenticated;
create trigger radar_atv_proteger_itens before insert or update on ixc.atividade_itens
for each row execute function radar_auditoria.radar_atv_proteger_itens();

create function radar_auditoria.radar_atv_proteger_fechamento()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.status='encerrada' then raise exception 'Atividade encerrada: historico preservado, sem edicao.'; end if;
  if old.validacao_solicitada_em is not null and
    row(new.prazo,new.prazo_hora,new.responsavel,new.responsavel_nome,new.iniciada_em)
    is distinct from row(old.prazo,old.prazo_hora,old.responsavel,old.responsavel_nome,old.iniciada_em) then
    raise exception 'Devolva a tarefa para ajuste antes de alterar prazo ou responsavel.';
  end if;
  return new;
end $$;
revoke all on function radar_auditoria.radar_atv_proteger_fechamento() from public,anon,authenticated;
create trigger radar_atv_proteger_fechamento before update on ixc.atividades
for each row execute function radar_auditoria.radar_atv_proteger_fechamento();

create function radar_auditoria.radar_atv_historico(p_inicio date,p_fim date,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare linhas jsonb;
begin
  if auth.uid() is null or coalesce(public.radar_perfil(),'') not in ('admin','lider') then
    raise exception 'Somente gestores e lideranca consultam o historico da equipe.' using errcode='42501'; end if;
  if p_inicio is null or p_fim is null or p_fim<p_inicio then raise exception 'Periodo invalido.'; end if;
  select coalesce(jsonb_agg(x order by encerrada_em desc,id desc),'[]'::jsonb) into linhas from (
    select a.id,a.titulo,a.tipo,a.responsavel_nome,a.criado_em,a.encerrada_em,a.encerrada_por_nome,
      a.decisao_obs,case when a.removida_em is not null then 'Cancelada' else 'Concluida' end as etapa,
      a.fechamento_resumo is not null as retrato_fechamento,
      coalesce(a.fechamento_resumo->>'total',(select count(*)::text from ixc.atividade_itens i where i.atividade_id=a.id)) as total,
      a.fechamento_resumo->>'tratados' as tratados,a.fechamento_resumo->>'pendentes' as pendentes,
      a.fechamento_resumo->>'aguardando' as aguardando,a.fechamento_resumo->>'resolvidos_ixc' as resolvidos_ixc
    from ixc.atividades a where a.status='encerrada'
      and a.encerrada_em >= (p_inicio::timestamp at time zone 'America/Sao_Paulo')
      and a.encerrada_em < ((p_fim+1)::timestamp at time zone 'America/Sao_Paulo')
    order by a.encerrada_em desc,a.id desc offset greatest(coalesce(p_offset,0),0) limit 101
  ) x;
  return linhas;
end $$;
revoke all on function radar_auditoria.radar_atv_historico(date,date,integer) from public,anon;
grant execute on function radar_auditoria.radar_atv_historico(date,date,integer) to authenticated;
create function public.radar_atv_historico(p_inicio date,p_fim date,p_offset integer default 0)
returns jsonb language sql security invoker set search_path='' as $$
  select radar_auditoria.radar_atv_historico(p_inicio,p_fim,p_offset);
$$;
revoke all on function public.radar_atv_historico(date,date,integer) from public,anon;
grant execute on function public.radar_atv_historico(date,date,integer) to authenticated;

create function radar_auditoria.radar_atv_historico_detalhe(p_atividade bigint)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a ixc.atividades%rowtype; eventos jsonb; itens jsonb;
begin
  if auth.uid() is null or coalesce(public.radar_perfil(),'') not in ('admin','lider') then
    raise exception 'Somente gestores e lideranca consultam o historico da equipe.' using errcode='42501'; end if;
  select * into a from ixc.atividades where id=p_atividade and status='encerrada';
  if not found then raise exception 'Atividade encerrada nao encontrada.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('em',e.em,'por_nome',e.por_nome,'acao',e.acao,'obs',e.obs,'item_id',e.item_id) order by e.em,e.id),'[]'::jsonb)
    into eventos from ixc.atividade_eventos e where e.atividade_id=a.id;
  itens := a.fechamento_resumo->'itens';
  if itens is null then select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb) into itens from ixc.atividade_itens i where i.atividade_id=a.id; end if;
  return jsonb_build_object('atividade',jsonb_build_object('id',a.id,'titulo',a.titulo,'responsavel_nome',a.responsavel_nome,
    'criado_em',a.criado_em,'criado_por_nome',a.criado_por_nome,'prazo',a.prazo,'prazo_hora',a.prazo_hora,
    'encerrada_em',a.encerrada_em,'encerrada_por_nome',a.encerrada_por_nome,'decisao_obs',a.decisao_obs,
    'cancelada',a.removida_em is not null,'retrato_fechamento',a.fechamento_resumo is not null),
    'eventos',eventos,'itens',itens);
end $$;
revoke all on function radar_auditoria.radar_atv_historico_detalhe(bigint) from public,anon;
grant execute on function radar_auditoria.radar_atv_historico_detalhe(bigint) to authenticated;
create function public.radar_atv_historico_detalhe(p_atividade bigint)
returns jsonb language sql security invoker set search_path='' as $$
  select radar_auditoria.radar_atv_historico_detalhe(p_atividade);
$$;
revoke all on function public.radar_atv_historico_detalhe(bigint) from public,anon;
grant execute on function public.radar_atv_historico_detalhe(bigint) to authenticated;
