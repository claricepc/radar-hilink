-- De/para decidido pela Clarice em 13/11/2026, a aplicar quando o Supabase voltar.
insert into fin.depara_regra (prioridade, padrao, conta_codigo, campo, ativo, obs) values
 (5, '\m(GMI|KGM)\M', '4.1.1.02', 'descricao', true, 'Clarice 13/11: GMI e KGM = fornecedores de material (ONT)'),
 (5, '\mRENOVACAO FROTA\M', '1.2.3.03', 'descricao', true, 'Clarice 13/11: renovacao da frota Kwid = compra de carro (imobilizado)');

-- Clarice 13/11: Ronaldo e socio de Itapissuma
insert into fin.plano_contas (codigo, descricao, tipo, natureza, nivel, analitica, ativo, dre_linha, pai_codigo, importado_em)
values ('1.1.3.07','Adiantamento a Sócios — Ronaldo (Itapissuma)','ATIVO','DEVEDORA',4,true,true,null,'1.1.3', now())
on conflict (codigo) do nothing;

-- Clarice 13/11: liberar Contas a pagar para a Caroline (conferir antes as colunas de fin.acesso e se ela esta ativa em radar_usuarios)
insert into fin.acesso (email) values ('caroline@hilink.com.br') on conflict do nothing;

-- Registro de quem alterou a classificacao (para a lista "Alteracoes da semana" com desfazer)
create table if not exists fin.depara_alteracao (
  id bigint generated always as identity primary key,
  em timestamptz not null default now(),
  usuario text,
  filial text not null,
  desc_norm text not null,
  conta_antes text,
  conta_depois text,
  desfeita_em timestamptz
);
create or replace function fin.tg_depara_alteracao() returns trigger language plpgsql security definer set search_path = fin, public, pg_temp as $$
begin
  insert into fin.depara_alteracao (usuario, filial, desc_norm, conta_antes, conta_depois)
  values (coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email', current_user),
          coalesce(new.filial, old.filial), coalesce(new.desc_norm, old.desc_norm),
          case when tg_op = 'INSERT' then null else old.conta_codigo end,
          case when tg_op = 'DELETE' then null else new.conta_codigo end);
  return null;
end $$;
drop trigger if exists depara_alteracao on fin.depara_manual;
create trigger depara_alteracao after insert or update or delete on fin.depara_manual for each row execute function fin.tg_depara_alteracao();
