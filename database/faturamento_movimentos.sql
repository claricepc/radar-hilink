-- Separate Radar cache. Every outbound IXC request uses only ixcsoft=listar.
create table ixc.fat_cargas (
  id uuid primary key default gen_random_uuid(), por uuid not null,
  de date not null, ate date not null, filiais text[],
  status text not null default 'buscando', erro text,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
  check (status in ('buscando','mapeando','pronto','erro'))
);
create table ixc.fat_fila (
  id bigint generated always as identity primary key, carga uuid not null references ixc.fat_cargas on delete cascade,
  etapa text not null, pagina int not null, ids text[], req bigint,
  status text not null default 'pedido', total int, tentativas int not null default 1,
  pedido_em timestamptz not null default now(), unique(carga,etapa,pagina)
);
create table ixc.fat_movimentos (
  carga uuid not null references ixc.fat_cargas on delete cascade, id text not null, grupo text not null,
  dia date not null, filial text not null, conta text, documento text, tipo text,
  credito numeric(18,2) not null, debito numeric(18,2) not null, primary key(carga,id)
);
create index fat_mov_grupo on ixc.fat_movimentos(carga,grupo);
create table ixc.fat_titulos (
  carga uuid not null references ixc.fat_cargas on delete cascade, id text not null,
  carteira text, status text not null default 'pendente', primary key(carga,id)
);
create table ixc.fat_refs (
  carga uuid not null references ixc.fat_cargas on delete cascade,
  tipo text not null,id text not null,nome text not null,planejamento text,primary key(carga,tipo,id)
);
alter table ixc.fat_cargas enable row level security;
alter table ixc.fat_fila enable row level security;
alter table ixc.fat_movimentos enable row level security;
alter table ixc.fat_titulos enable row level security;
alter table ixc.fat_refs enable row level security;
revoke all on ixc.fat_cargas,ixc.fat_fila,ixc.fat_movimentos,ixc.fat_titulos,ixc.fat_refs from public,anon,authenticated;

create function ixc.fat_autorizar() returns uuid language plpgsql security definer
set search_path=pg_catalog,public,ixc as $$
declare u uuid:=auth.uid();
begin
  if u is null or not exists(select 1 from public.radar_usuarios where auth_user_id=u and status='ativo')
    or public.radar_perfil() not in ('admin','lider') then raise exception 'Acesso restrito a gestao/lideranca ativa.'; end if;
  return u;
end $$;

create function ixc.fat_pedir(p_carga uuid,p_etapa text,p_pagina int,p_ids text[] default null)
returns void language plpgsql security definer set search_path=pg_catalog,ixc,public as $$
declare c ixc.fat_cargas; b jsonb; rota text; filtros jsonb;
begin
  select * into strict c from ixc.fat_cargas where id=p_carga;
  if p_etapa='movimentos' then
    rota:='fn_movim_finan';
    filtros:=jsonb_build_array(jsonb_build_object('TB','fn_movim_finan.data','OP','<=','P',c.ate::text));
    if c.filiais is not null then filtros:=filtros||jsonb_build_array(jsonb_build_object('TB','fn_movim_finan.filial_id','OP','IN','P',array_to_string(c.filiais,','))); end if;
    b:=jsonb_build_object('qtype',rota||'.data','query',c.de::text,'oper','>=','page',p_pagina::text,'rp','1000','sortname',rota||'.id','sortorder','asc','grid_param',filtros::text);
  elsif p_etapa='titulos' then
    rota:='fn_areceber';
    if p_ids is null or cardinality(p_ids)>250 or exists(select 1 from unnest(p_ids) v where v !~ '^[0-9]+$') then raise exception 'IDs invalidos'; end if;
    b:=jsonb_build_object('qtype',rota||'.id','query','0','oper','>','page','1','rp','1000','sortname',rota||'.id','sortorder','asc','grid_param',jsonb_build_array(jsonb_build_object('TB',rota||'.id','OP','IN','P',array_to_string(p_ids,',')))::text);
  elsif p_etapa in ('contas','carteiras') then
    rota:=case when p_etapa='contas' then 'contas' else 'fn_carteira_cobranca' end;
    b:=jsonb_build_object('qtype',rota||'.id','query','0','oper','>','page','1','rp','500','sortname',rota||'.id','sortorder','asc');
  else raise exception 'Etapa invalida'; end if;
  insert into ixc.fat_fila(carga,etapa,pagina,ids,req) values(p_carga,p_etapa,p_pagina,p_ids,ixc.ixc_post(rota,b,true));
end $$;

create function public.radar_faturamento_solicitar(p_de date,p_ate date,p_filiais text[] default null)
returns uuid language plpgsql security definer set search_path=pg_catalog,public,ixc as $$
declare u uuid; v uuid; ff text[];
begin
  u:=ixc.fat_autorizar();
  if p_de is null or p_ate is null or p_ate<p_de or p_ate-p_de>1096 or p_ate>current_date then raise exception 'Periodo invalido (limite: 3 anos ate hoje).'; end if;
  if p_filiais is not null then
    if cardinality(p_filiais)=0 or cardinality(p_filiais)>30 or exists(select 1 from unnest(p_filiais) f where f !~ '^[0-9]+$') then raise exception 'Selecione ao menos uma filial valida.'; end if;
    select array_agg(distinct f order by f) into ff from unnest(p_filiais) f;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text,744));
  select id into v from ixc.fat_cargas where por=u and de=p_de and ate=p_ate and filiais is not distinct from ff
    and ((status='pronto' and atualizado_em>now()-interval '30 minutes') or (status in ('buscando','mapeando') and criado_em>now()-interval '20 minutes')) order by criado_em desc limit 1;
  if v is not null then return v; end if;
  if (select count(*) from ixc.fat_cargas where por=u and status in ('buscando','mapeando') and criado_em>now()-interval '20 minutes')>=2 then raise exception 'Aguarde as consultas em andamento.'; end if;
  insert into ixc.fat_cargas(por,de,ate,filiais) values(u,p_de,p_ate,ff) returning id into v;
  perform ixc.fat_pedir(v,'movimentos',1);
  perform ixc.fat_pedir(v,'contas',1);
  perform ixc.fat_pedir(v,'carteiras',1);
  return v;
end $$;

create function ixc.fat_processar() returns int language plpgsql security definer
set search_path=pg_catalog,ixc,public as $$
declare f record; resp record; j jsonb; n int; esperado int; nextpag int; maxpag int; c record; lote text[]; map_pag int;
begin
  if not pg_try_advisory_xact_lock(7190344) then return 0; end if;
  update ixc.fat_cargas set status='erro',erro='Consulta excedeu 20 minutos. Selecione menos filiais e tente novamente.',atualizado_em=now()
    where status in ('buscando','mapeando') and criado_em<now()-interval '20 minutes';
  for f in select q.* from ixc.fat_fila q join ixc.fat_cargas job on job.id=q.carga where q.status='pedido' and job.status in ('buscando','mapeando') order by q.id limit 12 for update of q skip locked loop
    select * into resp from net._http_response where id=f.req;
    if not found and f.pedido_em>now()-interval '3 minutes' then continue; end if;
    begin
      if resp.id is null or resp.status_code is distinct from 200 then raise exception 'Falha de conexao com o IXC'; end if;
      j:=resp.content::jsonb;
      if j->>'type'='error' then raise exception '%',j->>'message'; end if;
      if not(j ? 'total') then raise exception 'Resposta incompleta do IXC'; end if;
      n:=jsonb_array_length(coalesce(j->'registros','[]'::jsonb));
      esperado:=(j->>'total')::int;
      if f.etapa='movimentos' then
        if esperado>500000 then raise exception 'Mais de 500 mil movimentos. Selecione menos filiais.'; end if;
        if n<>greatest(0,least(1000,esperado-(f.pagina-1)*1000)) then raise exception 'Pagina incompleta de movimentos'; end if;
        if exists(select 1 from ixc.fat_fila where carga=f.carga and etapa=f.etapa and total is not null and total<>esperado) then raise exception 'A base mudou durante a consulta. Tente novamente.'; end if;
        insert into ixc.fat_movimentos(carga,id,grupo,dia,filial,conta,documento,tipo,credito,debito)
          select f.carga,x->>'id',coalesce(nullif(x->>'id_movim_finan',''),x->>'id'),(x->>'data')::date,x->>'filial_id',x->>'id_conta',x->>'documento',x->>'tipo_lanc',coalesce(nullif(x->>'credito',''),'0')::numeric,coalesce(nullif(x->>'debito',''),'0')::numeric
          from jsonb_array_elements(coalesce(j->'registros','[]')) x on conflict(carga,id) do nothing;
        maxpag:=greatest(1,ceil(esperado/1000.0)::int);
        if f.pagina=1 then
          for nextpag in 2..least(4,maxpag) loop perform ixc.fat_pedir(f.carga,'movimentos',nextpag); end loop;
        else
          select max(pagina)+1 into nextpag from ixc.fat_fila where carga=f.carga and etapa='movimentos';
          if nextpag<=maxpag then perform ixc.fat_pedir(f.carga,'movimentos',nextpag); end if;
        end if;
      elsif f.etapa='titulos' then
        if esperado>cardinality(f.ids) or n<>esperado then raise exception 'Resposta incompleta de titulos'; end if;
        update ixc.fat_titulos set status='ausente' where carga=f.carga and id=any(f.ids);
        update ixc.fat_titulos t set carteira=nullif(x->>'id_carteira_cobranca',''),status='ok'
          from jsonb_array_elements(coalesce(j->'registros','[]')) x where t.carga=f.carga and t.id=x->>'id';
      else
        if esperado>500 or n<>esperado then raise exception 'Referencia incompleta'; end if;
        -- Never persist bank credentials, gateway tokens, or client secrets from reference responses.
        insert into ixc.fat_refs(carga,tipo,id,nome,planejamento)
          select f.carga,f.etapa,x->>'id',coalesce(nullif(x->>'descricao',''),nullif(x->>'conta',''),nullif(x->>'carteira',''),x->>'id'),x->>'id_planejamento'
          from jsonb_array_elements(coalesce(j->'registros','[]')) x on conflict(carga,tipo,id) do nothing;
      end if;
      update ixc.fat_fila set status='gravado',total=esperado where id=f.id;
      update ixc.fat_cargas set atualizado_em=now() where id=f.carga;
      delete from net._http_response where id=f.req;
    exception when others then
      update ixc.fat_fila set status='erro' where id=f.id;
      update ixc.fat_cargas set status='erro',erro=left(sqlerrm,250),atualizado_em=now() where id=f.carga;
    end;
  end loop;
  for c in select * from ixc.fat_cargas where status in ('buscando','mapeando') loop
    if exists(select 1 from ixc.fat_fila where carga=c.id and etapa<>'titulos' and status<>'gravado') then continue; end if;
    if c.status='buscando' then
      if (select count(*) from ixc.fat_movimentos where carga=c.id)<>(select total from ixc.fat_fila where carga=c.id and etapa='movimentos' and pagina=1) then
        update ixc.fat_cargas set status='erro',erro='Contagem de movimentos incompleta' where id=c.id; continue;
      end if;
      insert into ixc.fat_titulos(carga,id) select distinct c.id,documento from ixc.fat_movimentos where carga=c.id and tipo='R' and documento ~ '^[0-9]+$' on conflict do nothing;
      update ixc.fat_cargas set status='mapeando' where id=c.id;
    end if;
    for n in 1..greatest(0,4-(select count(*) from ixc.fat_fila where carga=c.id and etapa='titulos' and status='pedido')) loop
      select array_agg(id) into lote from (select id from ixc.fat_titulos where carga=c.id and status='pendente' order by id limit 250) a;
      if lote is null then exit; end if;
      update ixc.fat_titulos set status='enviado' where carga=c.id and id=any(lote);
      select coalesce(max(pagina),0)+1 into map_pag from ixc.fat_fila where carga=c.id and etapa='titulos';
      perform ixc.fat_pedir(c.id,'titulos',map_pag,lote);
    end loop;
    if exists(select 1 from ixc.fat_titulos where carga=c.id and status in ('pendente','enviado')) then continue; end if;
    if exists(
      select 1 from (select grupo,sum(credito-debito) filter(where tipo<>'M') as partes,max(debito-credito) filter(where id=grupo and tipo='M') as banco
        from ixc.fat_movimentos where carga=c.id and grupo in (select grupo from ixc.fat_movimentos where carga=c.id and tipo='R' and documento ~ '^[0-9]+$') group by grupo) g
      where banco is null or abs(partes-banco)>.005
    ) then update ixc.fat_cargas set status='erro',erro='Movimentos sem contrapartida conciliada. Requer conferencia da supervisao.' where id=c.id; continue; end if;
    if exists(select 1 from ixc.fat_movimentos m where m.carga=c.id and m.tipo<>'M' and abs(m.credito-m.debito)>0
      and m.grupo in (select grupo from ixc.fat_movimentos where carga=c.id and tipo='R' and documento ~ '^[0-9]+$')
      and not exists(select 1 from ixc.fat_titulos t where t.carga=c.id and t.id=m.documento)
    ) then update ixc.fat_cargas set status='erro',erro='Lancamento sem titulo identificavel. Requer conferencia da supervisao.' where id=c.id; continue; end if;
    update ixc.fat_cargas set status='pronto',atualizado_em=now() where id=c.id;
  end loop;
  return 1;
end $$;

create function public.radar_faturamento_resultado(p_carga uuid) returns jsonb language plpgsql security definer
set search_path=pg_catalog,ixc,public as $$
declare u uuid; c ixc.fat_cargas; linhas jsonb; refs jsonb;
begin
  u:=ixc.fat_autorizar();
  select * into c from ixc.fat_cargas where id=p_carga and por=u;
  if not found then raise exception 'Consulta nao encontrada'; end if;
  if c.status='pronto' then
    select coalesce(jsonb_agg(to_jsonb(a) order by a.mes,a.filial,a.carteira),'[]') into linhas from (
      select to_char(p.dia,'YYYY-MM') mes,p.filial,coalesce(t.carteira,'sem-carteira') carteira,sum(m.credito-m.debito) recebido,count(distinct p.id) recebimentos
      from ixc.fat_movimentos m join ixc.fat_movimentos p on p.carga=m.carga and p.id=m.grupo and p.tipo='M'
      join ixc.fat_titulos t on t.carga=m.carga and t.id=m.documento
      where m.carga=c.id and m.tipo<>'M' and m.grupo in (select grupo from ixc.fat_movimentos where carga=c.id and tipo='R' and documento ~ '^[0-9]+$')
      group by 1,2,3
    ) a;
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'nome',nome) order by id),'[]') into refs from ixc.fat_refs where carga=c.id and tipo='carteiras';
  end if;
  return jsonb_build_object('id',c.id,'de',c.de,'ate',c.ate,'filiais',c.filiais,'status',c.status,'erro',c.erro,'atualizado_em',c.atualizado_em,
    'movimentos',(select count(*) from ixc.fat_movimentos where carga=c.id),
    'titulos',(select count(*) from ixc.fat_titulos where carga=c.id and status='ok'),
    'sem_carteira',(select count(*) from ixc.fat_titulos where carga=c.id and (status='ausente' or carteira is null)),
    'linhas',linhas,'carteiras',refs);
end $$;

revoke all on function ixc.fat_autorizar(),ixc.fat_pedir(uuid,text,int,text[]),ixc.fat_processar() from public,anon,authenticated;
revoke all on function public.radar_faturamento_solicitar(date,date,text[]),public.radar_faturamento_resultado(uuid) from public,anon;
grant execute on function public.radar_faturamento_solicitar(date,date,text[]),public.radar_faturamento_resultado(uuid) to authenticated;
select cron.schedule('hilink-faturamento-processar','10 seconds','select ixc.fat_processar()');
