-- Financial project only. No ledger values or existing policies are changed.
create role radar_cp_reader nologin nosuperuser nocreatedb nocreaterole nobypassrls;
create role radar_cp_consulta login inherit nosuperuser nocreatedb nocreaterole nobypassrls connection limit 3;
grant radar_cp_reader to radar_cp_consulta;
alter role radar_cp_consulta set default_transaction_read_only=on;
alter role radar_cp_consulta set statement_timeout='15s';
alter role radar_cp_consulta set search_path=public,pg_catalog;
grant connect on database postgres to radar_cp_consulta;
grant usage on schema public to radar_cp_reader;
grant select on public.empresas,public.lancamentos,public.plano_contas,public.extrato_bancario,
  public.contas_bancarias,public.lancamentos_contabeis,public.lancamentos_contabeis_itens to radar_cp_reader;

create policy radar_cp_empresas_read on public.empresas for select to radar_cp_reader
  using(codigo in ('RECIFE','MADALENA','JABOATAO','ITAPISSUMA','COHAB','CAMARAGIBE','NANDONET','PABLOM'));
create policy radar_cp_lancamentos_read on public.lancamentos for select to radar_cp_reader
  using(data_competencia>=date '2026-01-01' and exists(select 1 from public.empresas e where e.id=empresa_id
    and (e.codigo not in ('NANDONET','PABLOM') or data_competencia>=date '2026-09-01')));
create policy radar_cp_plano_read on public.plano_contas for select to radar_cp_reader using(true);
create policy radar_cp_contas_read on public.contas_bancarias for select to radar_cp_reader
  using(exists(select 1 from public.empresas e where e.id=empresa_id));
create policy radar_cp_extrato_read on public.extrato_bancario for select to radar_cp_reader
  using(data_transacao>=date '2026-01-01' and exists(select 1 from public.empresas e where e.id=empresa_id
    and (e.codigo not in ('NANDONET','PABLOM') or data_transacao>=date '2026-09-01')));
create policy radar_cp_razao_read on public.lancamentos_contabeis for select to radar_cp_reader
  using(data_lancamento>=date '2026-01-01' and exists(select 1 from public.empresas e where e.id=empresa_id
    and (e.codigo not in ('NANDONET','PABLOM') or data_lancamento>=date '2026-09-01')));
create policy radar_cp_itens_read on public.lancamentos_contabeis_itens for select to radar_cp_reader
  using(exists(select 1 from public.lancamentos_contabeis c where c.id=lancamento_id));

-- The random credential is generated and encrypted inside the server, never in Git.
do $setup$
declare senha text := encode(extensions.gen_random_bytes(32),'hex');
begin
  execute format('alter role radar_cp_consulta password %L',senha);
  perform vault.create_secret('postgresql://radar_cp_consulta:'||senha||
    '@db.ekgrzvmqptjnvmrgabmg.supabase.co:5432/postgres?sslmode=require',
    'cp_financeiro_readonly_url','Radar: dedicated read-only connection; transfer to Radar Vault server-side');
end $setup$;
