begin;
do $$
declare g record; op record; lider record; r jsonb; snap jsonb; negado boolean; n int;
begin
  select u.id,u.email into g from auth.users u where lower(u.email)=any(string_to_array(replace(lower((select valor from ixc.config where chave='radar_admins')),' ',''),',')) limit 1;
  select u.id,u.email into op from auth.users u join public.radar_usuarios p on lower(p.email)=lower(u.email) where lower(p.perfil)='atendente' limit 1;
  select u.id,u.email into lider from auth.users u join public.radar_usuarios p on lower(p.email)=lower(u.email) where lower(p.perfil)='lider' limit 1;
  assert g.id is not null and op.id is not null;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',g.id,'email',g.email,'role','authenticated')::text,true);
  insert into ixc.atividades(id,tipo,titulo,criado_por,responsavel,prazo) overriding system value
    values(-987654322,'cobrar','TESTE FLUXO SEM PERSISTENCIA',g.id,op.id,current_date+1),
          (-987654323,'cobrar','TESTE CANCELAMENTO SEM PERSISTENCIA',g.id,op.id,current_date+1);
  insert into ixc.atividade_itens(id,atividade_id,chave,id_cliente,situacao,obs,tratado_por_nome) overriding system value
    values(-987654322,-987654322,'teste-fluxo-1',0,'pendente','Preservar pendencia',null),
          (-987654323,-987654322,'teste-fluxo-2',0,'sem_resposta','Ligacao realizada','Pessoa teste'),
          (-987654324,-987654323,'teste-fluxo-3',0,'prometeu','Acordo vigente','Pessoa teste');
  insert into ixc.promessas(id_cliente,data_prometida,valor,item_id,registrado_por,registrado_por_nome,status,obs)
    values(0,current_date+1,10,-987654324,g.id,'Pessoa teste','ativa','Preservar promessa');
  r:=public.radar_atv_transicao(-987654322,'concluir','Decisao');assert not (r->>'ok')::boolean;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',op.id,'email',op.email,'role','authenticated')::text,true);
  r:=public.radar_atv_transicao(-987654322,'solicitar',' ');assert not (r->>'ok')::boolean;
  r:=public.radar_atv_transicao(-987654322,'solicitar','Ligacoes feitas; um cliente sem retorno.');assert (r->>'ok')::boolean;
  assert (select exists(select 1 from jsonb_array_elements(public.radar_atv_listar()) x where (x->>'id')::bigint=-987654322 and x->>'validacao_solicitada_em' is not null));
  r:=public.radar_atv_transicao(-987654322,'solicitar','Duplicada');assert not (r->>'ok')::boolean;
  negado:=false;begin perform public.radar_atv_transicao(-987654322,'concluir','Sem permissao');exception when insufficient_privilege then negado:=true;end;assert negado;
  negado:=false;begin perform public.radar_atv_transicao(-987654323,'cancelar','Sem permissao');exception when insufficient_privilege then negado:=true;end;assert negado;
  negado:=false;begin perform public.radar_atv_historico(current_date,current_date);exception when insufficient_privilege then negado:=true;end;assert negado;
  negado:=false;begin perform public.radar_atv_pegar(-987654322);exception when others then negado:=true;end;assert negado;
  negado:=false;begin perform public.radar_atv_registrar(-987654322,'sem_resposta','Bloqueado');exception when others then negado:=true;end;assert negado;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',g.id,'email',g.email,'role','authenticated')::text,true);
  negado:=false;begin perform public.radar_atv_prorrogar(-987654322,current_date+3,'18:00','Bloqueado',current_date+1,'18:00');exception when others then negado:=true;end;assert negado;
  r:=public.radar_atv_transicao(-987654322,'devolver','Retomar contato com cliente pendente.');assert (r->>'ok')::boolean;
  assert (select validacao_solicitada_em is null and decisao_obs='Retomar contato com cliente pendente.' from ixc.atividades where id=-987654322);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',op.id,'email',op.email,'role','authenticated')::text,true);
  r:=public.radar_atv_registrar(-987654322,'sem_resposta','Segunda tentativa');assert (r->>'ok')::boolean;
  r:=public.radar_atv_transicao(-987654322,'solicitar','Segunda tentativa sem retorno.');assert (r->>'ok')::boolean;
  if lider.id is not null then
    perform set_config('request.jwt.claims',jsonb_build_object('sub',lider.id,'email',lider.email,'role','authenticated')::text,true);
  else
    perform set_config('request.jwt.claims',jsonb_build_object('sub',g.id,'email',g.email,'role','authenticated')::text,true);
  end if;
  r:=public.radar_atv_transicao(-987654322,'concluir','Conferido pela lideranca.');assert (r->>'ok')::boolean;
  select fechamento_resumo into snap from ixc.atividades where id=-987654322;
  assert (snap->>'total')::int=2 and jsonb_array_length(snap->'itens')=2;
  assert (select count(*)=2 from ixc.atividade_itens where atividade_id=-987654322);
  negado:=false;begin update ixc.atividade_itens set obs='Nao pode editar' where id=-987654322;exception when others then negado:=true;end;assert negado;
  -- Reconciliation remains possible, but the closure evidence must not change.
  update ixc.atividade_itens set resolvido_em=now(),resolvido_origem='cliente' where id=-987654322;
  assert (select fechamento_resumo=snap from ixc.atividades where id=-987654322);
  r:=public.radar_atv_historico_detalhe(-987654322);assert r->'atividade'->>'retrato_fechamento'='true';assert r->'itens'=snap->'itens';
  assert jsonb_array_length(r->'eventos')>=5;
  r:=public.radar_atv_transicao(-987654322,'concluir','Duplicada');assert not (r->>'ok')::boolean;
  negado:=false;begin perform public.radar_atv_encerrar(-987654323);exception when others then negado:=true;end;assert negado;
  negado:=false;begin perform public.radar_atv_remover(-987654323);exception when others then negado:=true;end;assert negado;
  r:=public.radar_atv_transicao(-987654323,'cancelar','Atividade criada por engano.');assert (r->>'ok')::boolean;
  assert (select status='ativa' from ixc.promessas where item_id=-987654324);
  r:=public.radar_atv_historico(current_date-1,current_date+1);select count(*) into n from jsonb_array_elements(r) x where (x->>'id')::bigint in (-987654322,-987654323);assert n=2;
  assert not exists(select 1 from jsonb_array_elements(public.radar_atv_listar()) x where (x->>'id')::bigint=-987654323);
  assert not has_function_privilege('anon','public.radar_atv_transicao(bigint,text,text)','execute');
  assert not has_function_privilege('anon','public.radar_atv_historico(date,date,integer)','execute');
  perform set_config('request.jwt.claims','{}',true);
  negado:=false;begin perform public.radar_atv_historico_detalhe(-987654322);exception when insufficient_privilege then negado:=true;end;assert negado;
end $$;
rollback;
select 'PASS: solicitar, bloquear, devolver, concluir, cancelar, historico fixo, auditoria, permissoes e promessa preservada; teste revertido' as resultado;
