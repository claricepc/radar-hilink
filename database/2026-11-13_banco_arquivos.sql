-- Radar Hilink - extratos e francesinhas (13/11/2026)
-- 1) nome da filial usado nas pastas do Drive (HILINK - Documentos / {drive_nome} / EXTRATO / {ano})
-- 2) gravacao de extrato com troca por dia (evita duplicar quando o mesmo dia chega por OFX e por Excel)
-- 3) francesinhas (aviso de movimentacao da carteira de titulos do Santander)
-- 4) controle dos arquivos lidos do Drive e da fila de copia para o Drive
-- 5) alertas na agenda da Caroline quando falta extrato ou francesinha

alter table fin.conta_bancaria add column if not exists drive_nome text;
update fin.conta_bancaria set drive_nome = case conta
  when '4048/130021175' then 'RECIFE' when '4048/130011846' then 'JABOATAO' when '4039/130030876' then 'ITAPISSUMA'
  when '4309/130038865' then 'COHAB' when '4039/130027881' then 'MADALENA' when '4056/130041763' then 'NANDONET' end
where drive_nome is null;

alter table fin.extrato_arquivo add column if not exists drive_id text;
alter table fin.extrato_arquivo add column if not exists origem text;
alter table fin.extrato_arquivo add column if not exists dias_novos int;
alter table fin.extrato_arquivo add column if not exists dias_trocados int;

-- conta pelo numero (com ou sem agencia / digito)
create or replace function fin.conta_por_numero(p text) returns text
language sql stable set search_path = fin, public, pg_temp as $$
  select c.conta from fin.conta_bancaria c
  where split_part(c.conta,'/',2) = ltrim(regexp_replace(coalesce(p,''),'\D','','g'),'0')
     or split_part(c.conta,'/',2) = regexp_replace(coalesce(p,''),'\D','','g')
     or regexp_replace(coalesce(p,''),'\D','','g') like '%'||split_part(c.conta,'/',2)
  order by length(c.conta) limit 1
$$;

-- Gravacao: para cada dia do arquivo, se o Radar ainda nao tem aquele dia, grava;
-- se tem menos movimentos que o arquivo, troca o dia inteiro; se tem igual ou mais, mantem.
create or replace function fin.extrato_gravar(p_conta text, p_nome text, p_formato text, p_inicio date, p_fim date,
  p_movs jsonb, p_origem text, p_quem text, p_drive_id text default null)
returns jsonb language plpgsql security definer set search_path = fin, public, pg_temp as $$
declare n_total int; n_ins int := 0; d_novos int := 0; d_troca int := 0; d_mant int := 0; r record; ini date; fim date;
begin
  if not exists (select 1 from fin.conta_bancaria where conta = p_conta) then raise exception 'Conta bancária não cadastrada: %', p_conta; end if;
  create temp table if not exists _mov (data date, valor numeric, historico text, fit_id text, seq int) on commit drop;
  truncate _mov;
  insert into _mov
  select (x->>'data')::date, round((x->>'valor')::numeric,2), left(coalesce(x->>'historico',''),300), nullif(x->>'fit_id',''),
         row_number() over (partition by x->>'data', x->>'valor', coalesce(x->>'historico','') order by ord)
  from jsonb_array_elements(coalesce(p_movs,'[]')) with ordinality t(x, ord)
  where (x->>'data')::date >= date '2026-01-01' and (x->>'data')::date <= current_date and coalesce((x->>'valor')::numeric,0) <> 0;
  n_total := (select count(*) from _mov);
  ini := case when p_inicio is null then (select min(data) from _mov) else greatest(p_inicio, date '2026-01-01') end;
  fim := case when p_fim is null then (select max(data) from _mov) else least(p_fim, current_date) end;
  if ini is null then
    return jsonb_build_object('ok', true, 'movimentos', 0, 'novos', 0, 'aviso', 'nenhum movimento de 2026 no arquivo');
  end if;
  for r in select m.data, count(*) n_novo, (select count(*) from fin.extrato_mov e where e.conta = p_conta and e.data = m.data) n_tem
           from _mov m group by m.data loop
    if r.n_tem = 0 or r.n_novo > r.n_tem then
      if r.n_tem > 0 then delete from fin.extrato_mov where conta = p_conta and data = r.data; d_troca := d_troca + 1; else d_novos := d_novos + 1; end if;
      insert into fin.extrato_mov (conta, data, valor, historico, fit_id, chave, origem, arquivo)
      select p_conta, data, valor, historico, fit_id,
             md5(data::text||'|'||valor::text||'|'||upper(regexp_replace(historico,'\s+',' ','g'))||'|'||seq||'|'||coalesce(fit_id,'')), p_origem, p_nome
      from _mov where data = r.data
      on conflict (conta, chave) do nothing;
      get diagnostics n_ins = row_count;
    else
      d_mant := d_mant + 1;
    end if;
  end loop;
  insert into fin.extrato_arquivo (conta, nome, formato, periodo_inicio, periodo_fim, movimentos, novos, enviado_por, drive_id, origem, dias_novos, dias_trocados)
  values (p_conta, p_nome, p_formato, ini, fim, n_total,
          (select count(*) from fin.extrato_mov where conta = p_conta and arquivo = p_nome and carregado_em > now() - interval '1 minute'),
          p_quem, p_drive_id, p_origem, d_novos, d_troca);
  return jsonb_build_object('ok', true, 'conta', p_conta, 'inicio', ini, 'fim', fim, 'movimentos', n_total,
    'dias_novos', d_novos, 'dias_trocados', d_troca, 'dias_ja_tinha', d_mant);
end $$;
revoke all on function fin.extrato_gravar(text,text,text,date,date,jsonb,text,text,text) from public, anon, authenticated;

-- RPC antiga (tela de extratos) passa a usar a mesma gravacao
create or replace function public.radar_cp_extrato_importar(p_conta text, p_nome text, p_formato text, p_inicio date, p_fim date, p_movs jsonb)
returns jsonb language plpgsql security definer set search_path = fin, public, pg_temp as $$
declare quem text := nullif(current_setting('request.jwt.claims', true),'')::jsonb->>'email';
begin
  perform fin.exigir_acesso();
  if p_inicio is null or p_fim is null or p_fim < p_inicio then raise exception 'Período do extrato inválido'; end if;
  if p_fim < date '2026-01-01' then raise exception 'O Radar processa extratos a partir de 01/01/2026'; end if;
  return fin.extrato_gravar(p_conta, p_nome, p_formato, p_inicio, p_fim, p_movs, 'upload', quem, null);
end $$;

-- Francesinhas
create table if not exists fin.francesinha (
  id bigint generated always as identity primary key,
  conta text not null references fin.conta_bancaria(conta),
  data_movimento date not null,
  no_aviso text not null,
  arquivo text,
  drive_id text,
  creditos jsonb not null default '[]',        -- lancamentos em conta corrente [{data, historico, valor}]
  credito_total numeric,
  liquidados int, valor_titulos numeric, juros numeric, descontos numeric, valor_pago numeric, tarifas_liquidacao numeric,
  baixas int, valor_baixas numeric, tarifas_baixa numeric,
  entradas int, valor_entradas numeric, tarifas_entrada numeric,
  saldo_carteira numeric, titulos_vencidos numeric,
  carregado_em timestamptz not null default now(),
  carregado_por text,
  unique (conta, data_movimento, no_aviso)
);
create table if not exists fin.francesinha_titulo (
  id bigint generated always as identity primary key,
  francesinha_id bigint not null references fin.francesinha(id) on delete cascade,
  tipo text not null check (tipo in ('liquidacao','baixa','entrada')),
  pagador text, seu_numero text, nosso_numero text,
  vencimento date, data_pagamento date,
  valor_titulo numeric, juros numeric, desconto numeric, valor_pago numeric, tarifa numeric,
  evento text
);
create index if not exists francesinha_titulo_fr on fin.francesinha_titulo (francesinha_id);
create index if not exists francesinha_titulo_seu on fin.francesinha_titulo (seu_numero) where tipo = 'liquidacao';
alter table fin.francesinha enable row level security;
alter table fin.francesinha_titulo enable row level security;

create or replace function fin.francesinha_gravar(p_conta text, p_nome text, p_aviso jsonb, p_quem text, p_drive_id text default null)
returns jsonb language plpgsql security definer set search_path = fin, public, pg_temp as $$
declare v_id bigint; v_data date := (p_aviso->>'data_movimento')::date; v_no text := p_aviso->>'no_aviso'; trocou boolean;
begin
  if not exists (select 1 from fin.conta_bancaria where conta = p_conta) then raise exception 'Conta bancária não cadastrada: %', p_conta; end if;
  if v_data is null or v_data < date '2026-01-01' then return jsonb_build_object('ok', true, 'ignorado', 'antes de 2026'); end if;
  trocou := exists (select 1 from fin.francesinha where conta = p_conta and data_movimento = v_data and no_aviso = v_no);
  delete from fin.francesinha where conta = p_conta and data_movimento = v_data and no_aviso = v_no;
  insert into fin.francesinha (conta, data_movimento, no_aviso, arquivo, drive_id, creditos, credito_total,
    liquidados, valor_titulos, juros, descontos, valor_pago, tarifas_liquidacao, baixas, valor_baixas, tarifas_baixa,
    entradas, valor_entradas, tarifas_entrada, saldo_carteira, titulos_vencidos, carregado_por)
  select p_conta, v_data, v_no, p_nome, p_drive_id, coalesce(p_aviso->'creditos','[]'),
    (select sum((c->>'valor')::numeric) from jsonb_array_elements(coalesce(p_aviso->'creditos','[]')) c),
    (select count(*) from jsonb_array_elements(coalesce(p_aviso->'titulos','[]')) t where t->>'tipo' = 'liquidacao'),
    (select sum((t->>'valor_titulo')::numeric) from jsonb_array_elements(coalesce(p_aviso->'titulos','[]')) t where t->>'tipo' = 'liquidacao'),
    (select sum((t->>'juros')::numeric) from jsonb_array_elements(coalesce(p_aviso->'titulos','[]')) t where t->>'tipo' = 'liquidacao'),
    (select sum((t->>'desconto')::numeric) from jsonb_array_elements(coalesce(p_aviso->'titulos','[]')) t where t->>'tipo' = 'liquidacao'),
    (select sum((t->>'valor_pago')::numeric) from jsonb_array_elements(coalesce(p_aviso->'titulos','[]')) t where t->>'tipo' = 'liquidacao'),
    (select sum((t->>'tarifa')::numeric) from jsonb_array_elements(coalesce(p_aviso->'titulos','[]')) t where t->>'tipo' = 'liquidacao'),
    (select count(*) from jsonb_array_elements(coalesce(p_aviso->'titulos','[]')) t where t->>'tipo' = 'baixa'),
    (select sum((t->>'valor_titulo')::numeric) from jsonb_array_elements(coalesce(p_aviso->'titulos','[]')) t where t->>'tipo' = 'baixa'),
    (select sum((t->>'tarifa')::numeric) from jsonb_array_elements(coalesce(p_aviso->'titulos','[]')) t where t->>'tipo' = 'baixa'),
    (select count(*) from jsonb_array_elements(coalesce(p_aviso->'titulos','[]')) t where t->>'tipo' = 'entrada'),
    (select sum((t->>'valor_titulo')::numeric) from jsonb_array_elements(coalesce(p_aviso->'titulos','[]')) t where t->>'tipo' = 'entrada'),
    (select sum((t->>'tarifa')::numeric) from jsonb_array_elements(coalesce(p_aviso->'titulos','[]')) t where t->>'tipo' = 'entrada'),
    nullif(p_aviso->>'saldo_carteira','')::numeric, nullif(p_aviso->>'titulos_vencidos','')::numeric, p_quem
  returning id into v_id;
  insert into fin.francesinha_titulo (francesinha_id, tipo, pagador, seu_numero, nosso_numero, vencimento, data_pagamento,
    valor_titulo, juros, desconto, valor_pago, tarifa, evento)
  select v_id, t->>'tipo', t->>'pagador', t->>'seu_numero', t->>'nosso_numero', nullif(t->>'vencimento','')::date, nullif(t->>'data_pagamento','')::date,
    nullif(t->>'valor_titulo','')::numeric, nullif(t->>'juros','')::numeric, nullif(t->>'desconto','')::numeric,
    nullif(t->>'valor_pago','')::numeric, nullif(t->>'tarifa','')::numeric, t->>'evento'
  from jsonb_array_elements(coalesce(p_aviso->'titulos','[]')) t;
  return jsonb_build_object('ok', true, 'conta', p_conta, 'data_movimento', v_data, 'aviso', v_no, 'trocou', trocou,
    'titulos', (select count(*) from fin.francesinha_titulo where francesinha_id = v_id));
end $$;
revoke all on function fin.francesinha_gravar(text,text,jsonb,text,text) from public, anon, authenticated;

-- Arquivos do Drive ja lidos (o script do Google pergunta antes de mandar)
create table if not exists fin.banco_arquivo (
  drive_id text primary key,
  nome text, tipo text, conta text, modificado_em timestamptz, resultado jsonb, lido_em timestamptz not null default now()
);
alter table fin.banco_arquivo enable row level security;

-- Fila: arquivo enviado pelo Radar que ainda precisa ir para o Drive (o script do Google busca e grava)
create table if not exists fin.banco_upload (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('extrato','francesinha')),
  conta text not null references fin.conta_bancaria(conta),
  nome_drive text not null, ano int not null, mime text, base64 text,
  enviado_por text, enviado_em timestamptz not null default now(),
  drive_id text, drive_url text, no_drive_em timestamptz, erro text
);
alter table fin.banco_upload enable row level security;

-- Visao por conta (tela Extratos): ate quando tem extrato e francesinha
create or replace function public.radar_cp_extratos()
returns jsonb language plpgsql stable security definer set search_path = fin, public, pg_temp as $$
begin
  perform fin.exigir_acesso();
  return jsonb_build_object('hoje', current_date,
    'uploads_pendentes', (select count(*) from fin.banco_upload where drive_id is null and erro is null),
    'contas', (select coalesce(jsonb_agg(x order by x->>'filial', x->>'conta'), '[]'::jsonb) from (
    select jsonb_build_object('conta', c.conta, 'filial', c.filial, 'descricao', c.descricao, 'banco', c.banco, 'drive_nome', c.drive_nome,
      'ate', (select max(periodo_fim) from fin.extrato_arquivo a where a.conta = c.conta),
      'movimentos', (select count(*) from fin.extrato_mov e where e.conta = c.conta),
      'francesinha_ate', (select max(data_movimento) from fin.francesinha f where f.conta = c.conta),
      'francesinhas', (select count(*) from fin.francesinha f where f.conta = c.conta),
      'buracos', (select coalesce(jsonb_agg(jsonb_build_object('de', de, 'ate', ate) order by de), '[]'::jsonb) from (
          select min(d) de, max(d) ate from (
            select d, d - (row_number() over (order by d))::int grp from (
              select d::date d from generate_series(date '2026-01-01', current_date - 1, interval '1 day') d
              where not exists (select 1 from fin.extrato_arquivo a where a.conta = c.conta and d::date between a.periodo_inicio and a.periodo_fim)) s) g
          group by grp) b),
      'arquivos', (select coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'de', periodo_inicio, 'ate', periodo_fim, 'movimentos', movimentos, 'novos', novos,
                     'dias_novos', dias_novos, 'dias_trocados', dias_trocados, 'origem', origem, 'por', enviado_por, 'em', em) order by em desc), '[]'::jsonb)
                   from (select * from fin.extrato_arquivo a where a.conta = c.conta order by em desc limit 5) a)) x
    from fin.conta_bancaria c where c.ativa) s));
end $$;
grant execute on function public.radar_cp_extratos() to authenticated;

-- Alertas na agenda da Caroline
create or replace function fin.dia_util_anterior(d date) returns date language sql immutable as $$
  select (d - g)::date from generate_series(1, 5) g where extract(isodow from d - g) < 6 order by g limit 1
$$;

create or replace function fin.alerta_extratos() returns int
language plpgsql security definer set search_path = fin, public, pg_temp as $$
declare carol uuid := (select auth_user_id from public.radar_usuarios where lower(email) = 'caroline@hilink.com.br');
  clarice uuid := (select auth_user_id from public.radar_usuarios where lower(email) = 'clarice@hilink.com.br');
  hoje date := (now() at time zone 'America/Recife')::date; esperado date := fin.dia_util_anterior((now() at time zone 'America/Recife')::date);
  r record; tit text; txt text; n int := 0; aberta uuid;
begin
  if carol is null or extract(isodow from hoje) > 5 then return 0; end if;
  for r in select c.conta, c.descricao, c.drive_nome,
             (select max(periodo_fim) from fin.extrato_arquivo a where a.conta = c.conta) ext_ate,
             (select max(data_movimento) from fin.francesinha f where f.conta = c.conta) fra_ate,
             exists (select 1 from fin.francesinha f where f.conta = c.conta) tem_fra
           from fin.conta_bancaria c where c.ativa loop
    tit := 'Extrato do banco: ' || r.descricao || ' (' || r.conta || ')';
    select id into aberta from radar_agenda.tarefas where responsavel = carol and titulo = tit and status in ('pendente','andamento') and arquivada_em is null limit 1;
    if coalesce(r.ext_ate, date '2025-12-31') >= esperado and (not r.tem_fra or coalesce(r.fra_ate, date '2025-12-31') >= fin.dia_util_anterior(esperado)) then
      if aberta is not null then update radar_agenda.tarefas set status = 'concluida', detalhes = detalhes || E'\n\nResolvido automaticamente em ' || to_char(hoje,'DD/MM') || ': arquivos em dia.' where id = aberta; end if;
      continue;
    end if;
    txt := 'O Radar não tem o extrato desta conta em dia.' || E'\n' ||
      '- Extrato no Radar até: ' || coalesce(to_char(r.ext_ate,'DD/MM/YYYY'),'nenhum em 2026') || ' (esperado até ' || to_char(esperado,'DD/MM') || ')' ||
      case when r.tem_fra then E'\n- Francesinha no Radar até: ' || coalesce(to_char(r.fra_ate,'DD/MM/YYYY'),'-') else '' end || E'\n\n' ||
      'Como resolver: baixe no Santander o extrato (OFX ou Excel) e, se houver, a francesinha do dia, e envie em Contas a pagar > Extratos do banco. ' ||
      'O Radar renomeia e guarda no Drive (HILINK - Documentos / ' || coalesce(r.drive_nome,'?') || '). ' ||
      'Arquivos salvos nas pastas de extrato/francesinha do Drive também são lidos sozinhos.' || E'\n' ||
      'Esta tarefa se fecha sozinha quando o extrato chegar.';
    if aberta is not null then
      update radar_agenda.tarefas set detalhes = txt, prazo = hoje where id = aberta;
    else
      insert into radar_agenda.tarefas (autor, responsavel, titulo, detalhes, prazo) values (coalesce(clarice, carol), carol, tit, txt, hoje);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function fin.alerta_extratos() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from cron.job where jobname = 'fin-alerta-extratos') then
    perform cron.schedule('fin-alerta-extratos', '0 12 * * 1-5', 'select fin.alerta_extratos()');
  end if;
end $$;
