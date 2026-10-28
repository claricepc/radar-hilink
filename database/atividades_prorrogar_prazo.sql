create function radar_auditoria.radar_atv_prorrogar(
  p_atividade bigint, p_prazo date, p_hora time, p_justificativa text,
  p_prazo_anterior date, p_hora_anterior time
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a ixc.atividades%rowtype;
  v_motivo text := btrim(coalesce(p_justificativa, ''));
  v_autor text;
begin
  if auth.uid() is null then raise exception 'Login necessario.' using errcode='42501'; end if;
  if coalesce(public.radar_perfil(), '') not in ('admin','lider') then
    raise exception 'Somente gestores e lideranca podem prorrogar tarefas.' using errcode='42501';
  end if;
  if v_motivo = '' or length(v_motivo) > 2000 then
    return jsonb_build_object('ok',false,'motivo','Informe a justificativa, com ate 2.000 caracteres.');
  end if;
  if p_prazo is null or p_hora is null or (p_prazo + p_hora) <= timezone('America/Sao_Paulo', clock_timestamp()) then
    return jsonb_build_object('ok',false,'motivo','Escolha uma data e um horario no futuro.');
  end if;
  select * into a from ixc.atividades where id=p_atividade and removida_em is null for update;
  if not found then return jsonb_build_object('ok',false,'motivo','Atividade nao encontrada.'); end if;
  if a.status <> 'aberta' then return jsonb_build_object('ok',false,'motivo','Esta atividade ja foi encerrada.'); end if;
  if a.prazo is distinct from p_prazo_anterior or coalesce(a.prazo_hora,'18:00'::time) is distinct from p_hora_anterior then
    return jsonb_build_object('ok',false,'motivo','O prazo foi alterado por outra pessoa. Atualize a tarefa e confira antes de prorrogar.');
  end if;
  if a.prazo is not null and (p_prazo+p_hora) <= (a.prazo+coalesce(a.prazo_hora,'18:00'::time)) then
    return jsonb_build_object('ok',false,'motivo','O novo prazo deve ser maior que o prazo atual.');
  end if;
  v_autor := ixc.radar_nome_atual();
  update ixc.atividades set prazo=p_prazo,prazo_hora=p_hora where id=a.id;
  insert into ixc.atividade_eventos(atividade_id,por,por_nome,acao,obs)
  values(a.id,auth.uid(),v_autor,'prorrogou prazo',
    'Prazo anterior: '||coalesce(to_char(a.prazo,'DD/MM/YYYY')||' '||to_char(coalesce(a.prazo_hora,'18:00'::time),'HH24:MI'),'sem prazo')||
    '. Novo prazo: '||to_char(p_prazo,'DD/MM/YYYY')||' '||to_char(p_hora,'HH24:MI')||
    '. Justificativa: '||v_motivo);
  return jsonb_build_object('ok',true,'prazo',p_prazo,'prazo_hora',to_char(p_hora,'HH24:MI'));
end $$;
revoke all on function radar_auditoria.radar_atv_prorrogar(bigint,date,time,text,date,time) from public,anon;
grant execute on function radar_auditoria.radar_atv_prorrogar(bigint,date,time,text,date,time) to authenticated;

create function public.radar_atv_prorrogar(
  p_atividade bigint,p_prazo date,p_hora time,p_justificativa text,p_prazo_anterior date,p_hora_anterior time
) returns jsonb language sql security invoker set search_path = '' as $$
  select radar_auditoria.radar_atv_prorrogar(p_atividade,p_prazo,p_hora,p_justificativa,p_prazo_anterior,p_hora_anterior);
$$;
revoke all on function public.radar_atv_prorrogar(bigint,date,time,text,date,time) from public,anon;
grant execute on function public.radar_atv_prorrogar(bigint,date,time,text,date,time) to authenticated;

create function radar_auditoria.radar_atv_prorrogacoes(p_atividade bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare a ixc.atividades%rowtype; v_perfil text;
begin
  if auth.uid() is null then raise exception 'Login necessario.' using errcode='42501'; end if;
  v_perfil := public.radar_perfil();
  select * into a from ixc.atividades where id=p_atividade and removida_em is null;
  if not found or not coalesce((coalesce(v_perfil,'') in ('admin','lider') or
    (v_perfil='atendente' and a.responsavel=auth.uid())),false) then
    raise exception 'Sem permissao para consultar esta tarefa.' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('em',e.em,'por_nome',e.por_nome,'descricao',e.obs) order by e.em desc,e.id desc)
    from ixc.atividade_eventos e where e.atividade_id=a.id and e.acao='prorrogou prazo'),'[]'::jsonb);
end $$;
revoke all on function radar_auditoria.radar_atv_prorrogacoes(bigint) from public,anon;
grant execute on function radar_auditoria.radar_atv_prorrogacoes(bigint) to authenticated;
create function public.radar_atv_prorrogacoes(p_atividade bigint)
returns jsonb language sql security invoker set search_path = '' as $$
  select radar_auditoria.radar_atv_prorrogacoes(p_atividade);
$$;
revoke all on function public.radar_atv_prorrogacoes(bigint) from public,anon;
grant execute on function public.radar_atv_prorrogacoes(bigint) to authenticated;
