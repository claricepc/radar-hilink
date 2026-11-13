-- Consulta pontual ao IXC SO LEITURA (ixcsoft: listar), feita pelo banco (o IP do banco e o liberado no IXC;
-- a edge function ixc-consulta recebe "Seu IP nao esta liberado"). Uso interno para auditoria de casos.
create or replace function ixc.consulta_listar(p_rota text, p_campo text, p_valor text, p_oper text default '=', p_rp int default 200)
returns bigint language plpgsql security definer set search_path = ixc, public, extensions as $$
declare v_tok text;
begin
  if p_rota not in ('fn_areceber','vd_saida','cliente_contrato','cliente','fn_areceber_baixas','vd_saida_produtos') then raise exception 'rota nao permitida'; end if;
  if p_oper not in ('=','>','<','>=','<=','L') then raise exception 'operador invalido'; end if;
  select decrypted_secret into v_tok from vault.decrypted_secrets where name = 'ixc_token' limit 1;
  return net.http_post(url := 'https://ixc.hilink.com.br/webservice/v1/'||p_rota,
    body := jsonb_build_object('qtype', p_rota||'.'||regexp_replace(p_campo,'[^a-z_]','','gi'), 'query', p_valor, 'oper', p_oper, 'page','1', 'rp', least(p_rp,1000)::text, 'sortname', p_rota||'.id', 'sortorder','asc'),
    headers := jsonb_build_object('Content-Type','application/json','ixcsoft','listar','Authorization','Basic '||replace(encode(convert_to(trim(v_tok),'UTF8'),'base64'), E'\n', '')),
    timeout_milliseconds := 60000);
end $$;
revoke all on function ixc.consulta_listar(text,text,text,text,int) from public, anon, authenticated;
create table if not exists ixc.auditoria_consulta (id bigint generated always as identity primary key, motivo text, id_cliente text, req_id bigint, em timestamptz default now());
alter table ixc.auditoria_consulta enable row level security;
-- Observacao: vd_saida (vendas) nao esta liberado para o usuario da API (grupo 26).
