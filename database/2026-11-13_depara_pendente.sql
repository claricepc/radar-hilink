-- De/para decidido pela Clarice em 13/11/2026, a aplicar quando o Supabase voltar.
insert into fin.depara_regra (prioridade, padrao, conta_codigo, campo, ativo, obs) values
 (5, '\m(GMI|KGM)\M', '4.1.1.02', 'descricao', true, 'Clarice 13/11: GMI e KGM = fornecedores de material (ONT)'),
 (5, '\mRENOVACAO FROTA\M', '1.2.3.03', 'descricao', true, 'Clarice 13/11: renovacao da frota Kwid = compra de carro (imobilizado)');

-- Clarice 13/11: Ronaldo e socio de Itapissuma
insert into fin.plano_contas (codigo, descricao, tipo, natureza, nivel, analitica, ativo, dre_linha, pai_codigo, importado_em)
values ('1.1.3.07','Adiantamento a Sócios — Ronaldo (Itapissuma)','ATIVO','DEVEDORA',4,true,true,null,'1.1.3', now())
on conflict (codigo) do nothing;
