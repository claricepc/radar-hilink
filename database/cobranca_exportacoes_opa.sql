-- Audit of CSV generation only; this does not confirm an OPA upload or message delivery.
create schema radar_auditoria;
revoke all on schema radar_auditoria from public, anon, authenticated;
grant usage on schema radar_auditoria to authenticated;
create table ixc.cobranca_exportacoes_opa (
  lote uuid not null,
  filial text not null check (length(filial) between 1 and 160),
  id_cliente text not null check (id_cliente ~ '^[0-9]{1,20}$'),
  arquivo text not null check (length(arquivo) between 1 and 240),
  filtro text not null check (length(filtro) <= 160),
  exportado_em timestamptz not null default now(),
  exportado_por uuid references auth.users(id) on delete set null,
  exportado_por_nome text not null,
  primary key (lote, filial, id_cliente)
);
create index cobranca_exportacoes_opa_cliente_idx
  on ixc.cobranca_exportacoes_opa (filial, id_cliente, exportado_em desc, lote);
alter table ixc.cobranca_exportacoes_opa enable row level security;
revoke all on ixc.cobranca_exportacoes_opa from public, anon, authenticated;

create function radar_auditoria.radar_cobranca_exportacoes_opa()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Login necessario' using errcode='42501'; end if;
  if public.radar_perfil() = 'atendente' then raise exception 'Acesso restrito' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(e)) from (
    select distinct on (filial, id_cliente)
      filial, id_cliente, exportado_em, exportado_por_nome, arquivo, filtro
    from ixc.cobranca_exportacoes_opa
    order by filial, id_cliente, exportado_em desc, lote desc
  ) e), '[]'::jsonb);
end $$;
revoke all on function radar_auditoria.radar_cobranca_exportacoes_opa() from public, anon;
grant execute on function radar_auditoria.radar_cobranca_exportacoes_opa() to authenticated;

create function radar_auditoria.radar_cobranca_registrar_exportacao_opa(
  p_lote uuid, p_clientes jsonb, p_arquivo text, p_filtro text default ''
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_usuario uuid := auth.uid(); v_nome text;
begin
  if v_usuario is null then raise exception 'Login necessario' using errcode='42501'; end if;
  if public.radar_perfil() = 'atendente' then raise exception 'Acesso restrito' using errcode='42501'; end if;
  if p_lote is null or jsonb_typeof(p_clientes) is distinct from 'array' then
    raise exception 'Lista de exportacao invalida' using errcode='22023';
  end if;
  if jsonb_array_length(p_clientes) not between 1 and 50000
     or p_arquivo is null or length(p_arquivo) not between 1 and 240
     or p_filtro is null or length(p_filtro) > 160 then
    raise exception 'Lista de exportacao invalida' using errcode='22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_clientes) c
    where jsonb_typeof(c) is distinct from 'object'
      or coalesce(c->>'id_cliente','') !~ '^[0-9]{1,20}$'
      or length(coalesce(c->>'filial','')) not between 1 and 160) then
    raise exception 'Cliente ou filial invalidos' using errcode='22023';
  end if;
  select coalesce(nullif(r.nome,''),u.email,'Usuario') into v_nome
    from auth.users u left join public.radar_usuarios r on r.auth_user_id=u.id
    where u.id=v_usuario limit 1;
  if v_nome is null then raise exception 'Usuario indisponivel' using errcode='42501'; end if;

  insert into ixc.cobranca_exportacoes_opa
    (lote, filial, id_cliente, arquivo, filtro, exportado_por, exportado_por_nome)
    select distinct p_lote, c->>'filial', c->>'id_cliente', p_arquivo, p_filtro, v_usuario, v_nome
    from jsonb_array_elements(p_clientes) c
    on conflict (lote, filial, id_cliente) do nothing;

  return coalesce((select jsonb_agg(to_jsonb(e)) from (
    select filial, id_cliente, exportado_em, exportado_por_nome, arquivo, filtro
    from ixc.cobranca_exportacoes_opa where lote=p_lote and exportado_por=v_usuario
      and (filial,id_cliente) in (select c->>'filial',c->>'id_cliente' from jsonb_array_elements(p_clientes) c)
  ) e), '[]'::jsonb);
end $$;
revoke all on function radar_auditoria.radar_cobranca_registrar_exportacao_opa(uuid,jsonb,text,text) from public, anon;
grant execute on function radar_auditoria.radar_cobranca_registrar_exportacao_opa(uuid,jsonb,text,text) to authenticated;

-- Exposed endpoints retain caller privileges; privileged access is isolated above.
create function public.radar_cobranca_exportacoes_opa()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select radar_auditoria.radar_cobranca_exportacoes_opa();
$$;
revoke all on function public.radar_cobranca_exportacoes_opa() from public, anon;
grant execute on function public.radar_cobranca_exportacoes_opa() to authenticated;

create function public.radar_cobranca_registrar_exportacao_opa(
  p_lote uuid, p_clientes jsonb, p_arquivo text, p_filtro text default ''
)
returns jsonb language sql security invoker set search_path = '' as $$
  select radar_auditoria.radar_cobranca_registrar_exportacao_opa(p_lote,p_clientes,p_arquivo,p_filtro);
$$;
revoke all on function public.radar_cobranca_registrar_exportacao_opa(uuid,jsonb,text,text) from public, anon;
grant execute on function public.radar_cobranca_registrar_exportacao_opa(uuid,jsonb,text,text) to authenticated;
