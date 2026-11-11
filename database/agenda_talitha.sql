begin;
create schema if not exists radar_agenda;
revoke all on schema radar_agenda from public, anon, authenticated;

create table radar_agenda.semanais (
  id uuid primary key default gen_random_uuid(),
  autor uuid not null references auth.users(id),
  titulo text not null,
  detalhes text not null default '',
  inicio date not null check (extract(isodow from inicio)=1)
);
alter table radar_agenda.semanais enable row level security;

create table radar_agenda.tarefas (
  id uuid primary key default gen_random_uuid(),
  autor uuid not null references auth.users(id),
  titulo text not null,
  detalhes text not null default '',
  prazo date,
  hora time check (hora is null or prazo is not null),
  semanal uuid references radar_agenda.semanais(id),
  unique (semanal,prazo),
  status text not null default 'pendente'
    check (status in ('pendente','andamento','bloqueada','concluida')),
  criada_em timestamptz not null default now(),
  arquivada_em timestamptz
);
create table radar_agenda.historico (
  id bigint generated always as identity primary key,
  tarefa uuid not null references radar_agenda.tarefas(id),
  autor uuid not null references auth.users(id),
  status text not null,
  justificativa text not null,
  em timestamptz not null default now()
);
create index on radar_agenda.historico(tarefa,id);
alter table radar_agenda.tarefas enable row level security;
alter table radar_agenda.historico enable row level security;
revoke all on all tables in schema radar_agenda from public, anon, authenticated;

create function public.radar_agenda_talitha(p_acao text default 'listar', p_dados jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  u uuid := auth.uid();
  clarice constant uuid := '7f7bccf3-db53-47df-8946-578f57016381';
  talitha constant uuid := '7d1a7dfb-687a-4e7a-8cbb-f1f6342ce34f';
  t radar_agenda.tarefas%rowtype;
  titulo text := btrim(coalesce(p_dados->>'titulo',''));
  detalhes text := btrim(coalesce(p_dados->>'detalhes',''));
  motivo text := btrim(coalesce(p_dados->>'justificativa',''));
  novo text := p_dados->>'status';
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if u is null or u not in (clarice,talitha) or not exists (
    select 1 from public.radar_usuarios where auth_user_id=u and status='ativo'
  ) then raise exception 'Acesso restrito à agenda.' using errcode='42501'; end if;

  if p_acao='criar' then
    if length(titulo) not between 1 and 160 or length(detalhes)>3000 or nullif(p_dados->>'prazo','') is null then
      raise exception 'Preencha o título e o prazo. Limite de 160 caracteres no título e 3.000 nos detalhes.';
    end if;
    insert into radar_agenda.tarefas(autor,titulo,detalhes,prazo,hora)
    values(u,titulo,detalhes,(p_dados->>'prazo')::date,nullif(p_dados->>'hora','')::time);
  elsif p_acao in ('atualizar','arquivar') then
    select * into t from radar_agenda.tarefas where id=(p_dados->>'id')::uuid for update;
    if not found or t.arquivada_em is not null then raise exception 'Tarefa indisponível.'; end if;
    if p_acao='arquivar' then
      if u<>clarice and t.autor<>u then
        raise exception 'Só Clarice pode arquivar uma tarefa que ela atribuiu.' using errcode='42501';
      end if;
      update radar_agenda.tarefas set arquivada_em=now() where id=t.id;
    else
      if novo is null or novo not in ('pendente','andamento','bloqueada','concluida')
        or length(motivo) not between 1 and 2000 then
        raise exception 'Informe o status e a justificativa (até 2.000 caracteres).';
      end if;
      update radar_agenda.tarefas set status=novo where id=t.id;
      insert into radar_agenda.historico(tarefa,autor,status,justificativa)
      values(t.id,u,novo,motivo);
    end if;
  elsif p_acao is distinct from 'listar' then
    raise exception 'Ação inválida.';
  end if;

  insert into radar_agenda.tarefas(autor,titulo,detalhes,prazo,semanal)
  select s.autor,s.titulo,s.detalhes,d::date,s.id
  from radar_agenda.semanais s
  cross join lateral generate_series(s.inicio::timestamp,
    (hoje + ((8-extract(isodow from hoje)::int)%7))::timestamp,interval '7 days') d
  on conflict (semanal,prazo) do nothing;

  return jsonb_build_object('tarefas',coalesce((
    select jsonb_agg(jsonb_build_object('id',a.id,'titulo',a.titulo,'detalhes',a.detalhes,
      'prazo',a.prazo,'hora',a.hora,'semanal',a.semanal is not null,'status',a.status,'arquivada_em',a.arquivada_em,
      'autor',case when a.autor=clarice then 'Clarice' else 'Talitha' end,
      'pode_arquivar',a.arquivada_em is null and (u=clarice or a.autor=u),
      'historico',coalesce((select jsonb_agg(jsonb_build_object('status',h.status,'justificativa',h.justificativa,
        'em',h.em,'autor',case when h.autor=clarice then 'Clarice' else 'Talitha' end) order by h.id desc)
        from radar_agenda.historico h where h.tarefa=a.id),'[]'::jsonb))
      order by (a.status='concluida'),a.prazo,a.criada_em,a.id)
    from radar_agenda.tarefas a
  ),'[]'::jsonb));
end;
$$;
revoke all on function public.radar_agenda_talitha(text,jsonb) from public, anon, authenticated;
grant execute on function public.radar_agenda_talitha(text,jsonb) to authenticated;
commit;
