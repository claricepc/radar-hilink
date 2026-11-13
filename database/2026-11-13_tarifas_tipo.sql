-- Tarifas bancárias por tipo (lidas do extrato) e alerta de cobrança acima do acordo com o Santander.
-- Usa o que já existia: fin.tarifa_acordada (proposta de retenção de 17/10/2025) e fin.tarifa_tipo (tipo do evento da francesinha).
-- Só lê extrato e francesinha. Nada é enviado ao banco, ao IXC ou a clientes.

-- 1) Tipo de tarifa a partir do histórico do extrato
create table if not exists fin.tarifa_tipo_info (
  tipo text primary key,
  nome text not null,
  conta_plano text,          -- conta do plano onde o tipo se encaixa (6.1.2.xx)
  acordo_tipo text,          -- tipo em fin.tarifa_acordada, quando há preço acordado
  ordem int not null default 99
);
insert into fin.tarifa_tipo_info (tipo, nome, conta_plano, acordo_tipo, ordem) values
  ('liq_outros_bancos', 'Liquidação: boleto pago em outro banco ou internet banking', '6.1.2.04', 'liquidacao', 1),
  ('liq_loterica',      'Liquidação: lotérica / correspondente físico',               '6.1.2.04', 'liquidacao', 2),
  ('liq_corban_digital','Liquidação: correspondente digital',                         '6.1.2.04', 'liquidacao', 3),
  ('liq_caixa',         'Liquidação: caixa ou autoatendimento Santander',             '6.1.2.04', 'liquidacao', 4),
  ('liq_pagfor',        'Liquidação: pagamento a fornecedor (Pagfor)',                '6.1.2.04', 'liquidacao', 5),
  ('liq_outra',         'Liquidação: outros canais',                                  '6.1.2.04', 'liquidacao', 6),
  ('pix_boleto',        'Boleto pago por PIX (QR Code)',                              '6.1.2.07', 'pix', 7),
  ('baixa',             'Baixa de título',                                            '6.1.2.05', 'baixa', 8),
  ('registro',          'Registro de boleto',                                         '6.1.2.06', 'registro', 9),
  ('manut_vencido',     'Manutenção de título vencido',                               '6.1.2.01', 'manutencao_vencido', 10),
  ('pacote',            'Pacote de serviços (mensalidade da conta)',                  '6.1.2.02', null, 11),
  ('pix_enviado',       'PIX enviado (tarifa avulsa)',                                '6.1.2.07', null, 12),
  ('ted',               'TED',                                                        '6.1.2.07', null, 13),
  ('outra',             'Outras tarifas',                                             '6.1.2.02', null, 14)
on conflict (tipo) do update set nome = excluded.nome, conta_plano = excluded.conta_plano, acordo_tipo = excluded.acordo_tipo, ordem = excluded.ordem;

create or replace function fin.tarifa_extrato_tipo(p_hist text)
returns text language sql immutable as $$
  select case
    when h !~ '^(TAR |TARIFA|ESTORNO (MENSALIDADE|TARIFA|TAR ))' then null
    when h ~ '^TAR LIQ COB' and h ~ 'COMPE' then 'liq_outros_bancos'
    when h ~ 'CORBAN FISICO' then 'liq_loterica'
    when h ~ 'CORBAN DIGITAL' then 'liq_corban_digital'
    when h ~ '^TAR LIQ COB' and h ~ '(CAIXA|AUTO ATEND)' then 'liq_caixa'
    when h ~ 'PAGFOR' then 'liq_pagfor'
    when h ~ '^TAR LIQ COB' then 'liq_outra'
    when h ~ 'BOLETO VIA QRCODE' then 'pix_boleto'
    when h ~ '^TAR BAIXA' then 'baixa'
    when h ~ '^TAR REG TIT' then 'registro'
    when h ~ 'MANUTENCAO TIT' then 'manut_vencido'
    when h ~ 'PACOTE SERVICO' then 'pacote'
    when h ~ 'ENVIO PIX' then 'pix_enviado'
    when h ~ 'TARIFA TED' then 'ted'
    else 'outra' end
  from (select upper(trim(coalesce(p_hist,''))) h) s
$$;

-- 2) Linhas de tarifa do extrato, já com tipo e preço acordado.
-- custo positivo = débito; negativo = estorno/devolução do banco.
-- multiplo_acordo: o valor do dia é múltiplo do preço acordado? Quando não é, o banco cobrou outro preço em parte dos títulos.
create or replace view fin.v_tarifa_extrato as
select m.id, m.conta, cb.filial, m.data, to_char(m.data, 'YYYY-MM') mes, t.tipo, i.nome, i.conta_plano, i.acordo_tipo,
       -m.valor as custo, (m.valor > 0) as estorno, m.historico, a.valor as preco_acordado,
       case when a.valor is null or m.valor > 0 then null
            when a.valor = 0 then false
            else abs(round(abs(m.valor) / a.valor) * a.valor - abs(m.valor)) < 0.005 end as multiplo_acordo
from fin.extrato_mov m
join lateral (select fin.tarifa_extrato_tipo(m.historico) tipo) t on t.tipo is not null
join fin.tarifa_tipo_info i on i.tipo = t.tipo
left join fin.conta_bancaria cb on cb.conta = m.conta
left join fin.tarifa_acordada a on a.tipo = i.acordo_tipo and m.data >= a.vigencia_inicio and (a.vigencia_fim is null or m.data <= a.vigencia_fim);

-- 3) Títulos da francesinha cobrados acima do acordo (fonte título a título)
create or replace view fin.v_tarifa_acima as
select f.conta, cb.filial, f.data_movimento as data, to_char(f.data_movimento, 'YYYY-MM') mes,
       fin.tarifa_tipo(case t.tipo when 'liquidacao' then 'LIQUIDACOES' when 'baixa' then 'BAIXAS' when 'entrada' then 'ENTRADAS' end, t.evento) as acordo_tipo,
       t.evento, t.tarifa as cobrado, a.valor as acordado, t.tarifa - a.valor as excesso
from fin.francesinha_titulo t
join fin.francesinha f on f.id = t.francesinha_id
left join fin.conta_bancaria cb on cb.conta = f.conta
join fin.tarifa_acordada a on a.tipo = fin.tarifa_tipo(case t.tipo when 'liquidacao' then 'LIQUIDACOES' when 'baixa' then 'BAIXAS' when 'entrada' then 'ENTRADAS' end, t.evento)
  and f.data_movimento >= a.vigencia_inicio and (a.vigencia_fim is null or f.data_movimento <= a.vigencia_fim)
where t.tarifa > a.valor + 0.001;

-- 4) Tarifas com preço acordado em meses sem francesinha da conta (ex.: NandoNet).
-- Sem a francesinha não dá para saber quantos títulos foram cobrados, então o excesso não é calculado: o grupo (conta, mês, tipo)
-- que tem algum dia que não fecha com o preço acordado fica "a conferir".
create or replace function fin.brl(p numeric) returns text language sql immutable as $$
  select translate(to_char(coalesce(p,0), 'FM999G999G990D00'), ',.', '.,')
$$;
create or replace view fin.v_tarifa_extrato_suspeita as
select e.*, null::numeric as preco_provavel, null::numeric as qtd_provavel, null::numeric as excesso_provavel
from fin.v_tarifa_extrato e
where e.preco_acordado is not null and not e.estorno and e.data >= '2026-01-01'
  and not exists (select 1 from fin.francesinha f where f.conta = e.conta and to_char(f.data_movimento,'YYYY-MM') = e.mes);

-- 5) Notas automáticas da DRE (o alerta vira uma pendência como as manuais)
alter table fin.dre_nota add column if not exists origem text;
alter table fin.dre_nota add column if not exists meses_ref text[];

-- 6) Dados para a tela
create or replace function public.radar_cp_tarifas(p_ano int default null, p_empresa text default null)
returns jsonb language plpgsql security definer set search_path to 'fin', 'public', 'pg_temp' as $$
declare v_ano int := coalesce(p_ano, extract(year from current_date)::int);
        ini date; fim date;
begin
  perform fin.exigir_acesso();
  ini := make_date(v_ano, 1, 1); fim := make_date(v_ano, 12, 31);
  return jsonb_build_object(
    'ano', v_ano,
    'acordo', (select jsonb_agg(jsonb_build_object('tipo', a.tipo, 'valor', a.valor, 'desde', a.vigencia_inicio, 'ate', a.vigencia_fim, 'fonte', a.fonte) order by a.tipo) from fin.tarifa_acordada a),
    'tipos', (select jsonb_agg(jsonb_build_object('tipo', tipo, 'nome', nome, 'conta_plano', conta_plano, 'acordo_tipo', acordo_tipo) order by ordem) from fin.tarifa_tipo_info),
    'extrato', coalesce((select jsonb_agg(x) from (
        select mes, tipo, filial, count(*) filter (where not estorno) n, round(sum(custo) filter (where not estorno), 2) cobrado,
               round(coalesce(sum(-custo) filter (where estorno), 0), 2) estornado
        from fin.v_tarifa_extrato where data between ini and fim and (p_empresa is null or filial = p_empresa)
        group by 1, 2, 3) x), '[]'),
    'acima', coalesce((select jsonb_agg(x) from (
        select mes, acordo_tipo, filial, conta, count(*) n, round(sum(cobrado), 2) cobrado, round(sum(acordado), 2) acordado, round(sum(excesso), 2) excesso,
               string_agg(distinct to_char(cobrado, 'FM0.00'), ' / ') precos
        from fin.v_tarifa_acima where data between ini and fim and (p_empresa is null or filial = p_empresa)
        group by 1, 2, 3, 4) x), '[]'),
    'suspeitas', coalesce((select jsonb_agg(x) from (
        select s.mes, s.tipo, s.nome, s.filial, s.conta, cb.descricao conta_nome, count(*) n, round(sum(s.custo), 2) cobrado, max(s.preco_acordado) acordado
        from fin.v_tarifa_extrato_suspeita s left join fin.conta_bancaria cb on cb.conta = s.conta
        where s.data between ini and fim and (p_empresa is null or s.filial = p_empresa)
        group by 1, 2, 3, 4, 5, 6 having bool_or(not s.multiplo_acordo)) x), '[]'),
    'cobertura', coalesce((select jsonb_agg(x) from (
        select cb.conta, cb.filial, cb.descricao,
               (select max(data) from fin.extrato_mov m where m.conta = cb.conta) extrato_ate,
               (select max(data_movimento) from fin.francesinha f where f.conta = cb.conta) francesinha_ate
        from fin.conta_bancaria cb where cb.ativa and (p_empresa is null or cb.filial = p_empresa)) x), '[]')
  );
end $$;
grant execute on function public.radar_cp_tarifas(int, text) to authenticated;

-- 7) Alerta: uma pendência aberta na DRE (linha Financeiras e tarifas) com o total cobrado acima do acordo e ainda não resolvido.
-- Meses já cobertos por um alerta resolvido não entram de novo. Atualiza o texto e a tarefa enquanto estiver aberta.
create or replace function fin.alerta_tarifas()
returns jsonb language plpgsql security definer set search_path to 'fin', 'public', 'pg_temp' as $$
declare v_resp text := 'clarice@hilink.com.br';
        cobertos text[]; meses text[]; txt text; det text; conf text; corpo text; v_total numeric;
        nota fin.dre_nota; v_tarefa uuid; uid uuid; ano_ref int;
begin
  select coalesce(array_agg(distinct m), '{}') into cobertos
  from fin.dre_nota n, unnest(n.meses_ref) m where n.origem = 'alerta_tarifas' and n.resolvida_em is not null and n.apagada_em is null;

  -- cobrado acima do acordo, título a título (francesinha)
  with a as (select mes, acordo_tipo, sum(excesso) ex from fin.v_tarifa_acima where data >= '2026-01-01' and not (mes = any(cobertos)) group by 1, 2)
  select (select round(sum(ex), 2) from a),
         (select string_agg(format('- %s: R$ %s', case t.k when 'liquidacao' then 'Liquidação' when 'baixa' then 'Baixa' when 'registro' then 'Registro'
                   when 'pix' then 'PIX no boleto' else 'Manutenção de título vencido' end, fin.brl(t.ex)), E'\n' order by t.ex desc)
            from (select acordo_tipo k, sum(ex) ex from a group by 1) t where t.ex > 0.5),
         (select array_agg(distinct mes order by mes) from a where ex > 0.5)
  into v_total, det, meses;

  -- extrato sem francesinha no mês e valor que não fecha com o preço acordado: a conferir
  select string_agg(format('- %s, %s, %s: R$ %s cobrados (acordo: R$ %s cada)', conta_nome, nome, to_char(to_date(mes || '-01', 'YYYY-MM-DD'), 'MM/YYYY'), fin.brl(c), fin.brl(pa)), E'\n' order by mes, conta_nome, c desc),
         (select array_agg(distinct x order by x) from unnest(coalesce(meses, '{}') || array_agg(mes)) x)
  into conf, meses
  from (select coalesce(cb.descricao, s.conta) conta_nome, s.nome, s.mes, sum(s.custo) c, max(s.preco_acordado) pa
        from fin.v_tarifa_extrato_suspeita s left join fin.conta_bancaria cb on cb.conta = s.conta
        where not (s.mes = any(cobertos)) group by 1, 2, 3 having bool_or(not s.multiplo_acordo) and sum(s.custo) >= 10) s;

  select * into nota from fin.dre_nota where origem = 'alerta_tarifas' and resolvida_em is null and apagada_em is null order by id desc limit 1;

  if coalesce(array_length(meses, 1), 0) = 0 or (coalesce(v_total, 0) < 1 and conf is null) then
    return jsonb_build_object('ok', true, 'alerta', false);
  end if;

  txt := case when coalesce(v_total, 0) >= 1
           then format('Santander cobrou R$ %s acima do acordo de tarifas entre %s e %s. Cobrar o estorno.', fin.brl(v_total),
                  to_char(to_date(meses[1] || '-01', 'YYYY-MM-DD'), 'MM/YYYY'), to_char(to_date(meses[array_length(meses, 1)] || '-01', 'YYYY-MM-DD'), 'MM/YYYY'))
           else 'Tarifas do Santander que não fecham com o preço acordado. Conferir com a francesinha.' end;
  corpo := txt || coalesce(E'\n\nCobrado acima do acordo (francesinha, título a título):\n' || det, '')
               || coalesce(E'\n\nA conferir (conta sem francesinha no mês; o valor não fecha com o preço acordado):\n' || conf, '')
               || E'\n\nDetalhe: DRE > Financeiras e tarifas > detalhes > Tarifas no extrato do banco.';
  ano_ref := left(meses[array_length(meses, 1)], 4)::int;

  if nota.id is null then
    insert into fin.dre_nota (ano, empresa, chave, mes, texto, pendencia, responsavel, prazo, autor, origem, meses_ref)
    values (ano_ref, null, 'linha:DESP_FINANC', null, corpo, true, v_resp, current_date + 15, 'radar', 'alerta_tarifas', meses)
    returning * into nota;
    select auth_user_id into uid from public.radar_usuarios where lower(email) = v_resp;
    if uid is not null then
      insert into radar_agenda.tarefas (autor, responsavel, titulo, detalhes, prazo)
      values (uid, uid, left('Tarifas: ' || txt, 120), corpo || E'\n\nAo concluir esta tarefa, a sinalização sai da DRE.', current_date + 15)
      returning id into v_tarefa;
      update fin.dre_nota set tarefa_id = v_tarefa where id = nota.id;
    end if;
    return jsonb_build_object('ok', true, 'alerta', true, 'novo', true, 'nota', nota.id, 'total', v_total);
  end if;

  if nota.texto is distinct from corpo or nota.meses_ref is distinct from meses then
    update fin.dre_nota set texto = corpo, meses_ref = meses, ano = ano_ref where id = nota.id;
    update radar_agenda.tarefas set titulo = left('Tarifas: ' || txt, 120), detalhes = corpo || E'\n\nAo concluir esta tarefa, a sinalização sai da DRE.'
     where id = nota.tarefa_id and status <> 'concluida';
  end if;
  return jsonb_build_object('ok', true, 'alerta', true, 'novo', false, 'nota', nota.id, 'total', v_total);
end $$;

-- roda nos dias úteis depois da leitura dos arquivos do banco
select cron.unschedule(jobid) from cron.job where jobname = 'fin-alerta-tarifas';
select cron.schedule('fin-alerta-tarifas', '20 12 * * 1-5', $$select fin.alerta_tarifas()$$);
