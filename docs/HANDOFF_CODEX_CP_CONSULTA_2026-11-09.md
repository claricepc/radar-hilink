# Contas a pagar - consulta e auditoria

## Estado exato em 09/11/2026

Autorizacoes de Clarice: comecar por consulta/auditoria mantendo o banco existente;
criar conexao tecnica somente de leitura e guarda-la no Vault do Radar.
Publicacao da tela continua dependendo de autorizacao expressa.

**Aplicado no banco:** acesso tecnico de leitura e credencial no Vault.
**Preparado apenas localmente:** tela, consultas e Edge Function.
**Nao aplicado:** deploy da Edge Function, commit, push, publicacao da tela, cron,
pagamentos, correcao de lancamentos, conciliacao, mudancas de usuarios da equipe.
Nenhuma chamada de escrita no IXC. Nenhum lancamento ou extrato foi modificado.

## Base de trabalho e preservacao

- Checkout isolado: C:\Hilink\RADAR HILINK\_cp_consulta_codex_20261109.
- Base: main 7deae4a10f4ab6d8cd24f08e61a845b46dfc5d35, clonada da producao.
- O HTML recebeu somente os pontos de integracao do novo modulo cp; 27 modulos
  anteriores continuam presentes. Isso nao substitui teste funcional de regressao.
- NOVO e TESTE nao foram sobrescritos. Nao copiar NOVO por cima da producao.
- A copia antiga _tmp_radar_checkbox_20261027 permanece com suas mudancas em
  dici-anatel.js, scripts/radar-drive-apps-script.gs e docs/. Nao foram revertidas.
- O menu Contas a receber ja estava presente na base clonada; nao foi recriado.

## Alteracoes remotas autorizadas

Projeto financeiro ekgrzvmqptjnvmrgabmg:

- Migration radar_cp_consulta_readonly_scope: roles radar_cp_reader (NOLOGIN) e
  radar_cp_consulta (LOGIN, sem SUPERUSER/BYPASSRLS/CREATEROLE/CREATEDB, limite 3).
- SELECT em empresas, lancamentos, plano_contas, extrato_bancario,
  contas_bancarias, lancamentos_contabeis e lancamentos_contabeis_itens.
- Sete policies SELECT exclusivas para radar_cp_reader, sem alterar policies
  existentes de anon/authenticated. RLS permaneceu habilitado.
- Escopo por codigo de empresa; Line Fibra excluida. Registros a partir de 2026;
  Nandonet/Pablom apenas desde 01/09/2026. Pablom nao existe como empresa na fonte
  consultada e nao foi criada automaticamente.
- default_transaction_read_only=on, statement_timeout=15s.
- Credencial aleatoria gerada no servidor e armazenada em Vault, nunca em Git,
  arquivos locais, HTML, mensagem ou saida de ferramenta exibida ao modelo.
- O segredo cp_financeiro_readonly_url tambem ficou no Vault da origem, como
  registro criptografado da configuracao. O acesso tecnico nao pode ler Vault.
- Migration radar_cp_verify_readonly_permissions: teste de leitura sob o papel
  dedicado, verificacao de ausencia de INSERT/UPDATE/DELETE e de USAGE no Vault.
  Grant temporario concedido por postgres foi revogado ao terminar.
  Supabase mantem seus grants administrativos automaticos, concedidos por
  supabase_admin ao criador postgres; nao sao usuarios adicionais do Radar.
- Duas tentativas anteriores de teste falharam e foram revertidas atomicamente
  (checagem de privilegio no schema Vault e troca de modo da transacao). Nao
  alteraram lancamentos nem deixaram grants temporarios dessas tentativas.

Projeto Radar mdhexsdnavzforuahgxn:

- Vault cp_financeiro_readonly_url criado em 09/11/2026 16:03:40 UTC.
- Transferencia ocorreu entre ferramentas sem imprimir credencial nem grava-la
  em arquivo. Nenhuma tabela financeira do Radar foi recriada/migrada.

## Contrato preparado

- supabase/functions/contas-pagar-consulta/index.ts: valida JWT via Auth getUser,
  UID/e-mail/status ativo em radar_usuarios e autorizacao em fin.acesso antes de
  consultar Vault. Nao aceita SQL enviado pelo cliente.
- Fonte usa exclusivamente radar_cp_consulta, transacao READ ONLY, parametros
  vinculados, limite 50 por pagina, periodo limitado e timeout de consulta.
- CORS com origens Hilink/GitHub especificas; no-store; erros sem SQL/segredos.
- core.mjs: oito consultas, sem reaproveitar painel_resumo que ignora p_mes nem
  dias_para_vencer antigo baseado em competencia.
- Agenda usa data_vencimento e despesas provisionadas. Sem vencimento nao entra.
- DRE e parcial, apenas despesas: nao representa lucro/fechamento aprovado.
- Caixa mostra movimentos, nunca saldo calculado sem extrato/saldo validado.
- Conciliação apenas mostra o registro existente, sem gravar ou confirmar.
- Auditoria distingue candidatos atuais dos achados ja registrados em
  fin.auditoria_achados. Achados antigos nao sao automaticamente revalidados.
- Aliases de achados: COHAB corresponde a COHAB/IG/IBURA; ITAPISSUMA a
  ITAPISSUMA/IGARASSU. Filial TODAS e identificada como achado geral.
- Nada e cacheado em localStorage; resposta obsoleta e descartada. Dados sao
  limpos ao sair da tela ou mudar de sessao. Sem fonte != valor zero.
- Menu recolhido por padrao e oculto ate autorizacao. A RPC radar_cp_pode original
  so controla visibilidade; a verificacao forte de status/UID esta no servidor.

## Evidencias de teste e limites

- scripts/test-cp-consulta.mjs: filtros invalidos, acesso negado, sanitizacao,
  17 consultas geradas, sintaxe de 15 scripts inline, 27 modulos preservados.
- As 17 consultas foram verificadas com EXPLAIN real no banco em transacao de
  leitura. Nao executam INSERT/UPDATE/DELETE. Sem codigo duplicado no plano de contas.
- scripts/test-cp-handler.mjs: 11 cenarios, incluindo origem, ausencia/expiracao
  de sessao, inativo, nao autorizado, UID divergente, configuracao ausente e
  rejeicao de conexao administrativa. Usa dependencias simuladas.
- scripts/test-cp-browser.cjs: oito abas, 1440x900 e 390x844, captura de tela,
  escape de texto da fonte, erro sem zero ficticio e descarte de resposta apos
  sair do modulo. Dados sinteticos somente no teste, nunca fallback de producao.
- Capturas em qa-cp/, ignorado no Git. Sintaxe do index.ts verificada por Node;
  isso nao substitui compilacao/deploy Deno.
- Advisors antes/depois: sem nova categoria de alerta; tabelas com RLS sem policy
  passaram de 38 para 36. Permanecem 10 views SECURITY DEFINER e outros avisos
  preexistentes. Nenhuma correcao global foi feita para nao afetar o financeiro.
- IMPORTANTE: default read-only e grants nao tornam todo o banco seguro; existem
  funcoes herdadas de PUBLIC. O caminho novo so permite consultas fixas e READ
  ONLY. Revisao global dessas funcoes e trabalho separado.
- Ainda NAO foi testada a conexao TCP/TLS da Edge Function ao outro projeto nem
  o fluxo completo com sessao real da Clarice/Urbano: funcao nao publicada.
- A DSN preparada usa host direto do projeto financeiro. Verificar conectividade
  da regiao Edge; se necessario usar pooler oficial confirmado no painel, sem
  adivinhar host, alterar grants ou trocar por credencial administrativa.
- Extratos continuam desatualizados: Recife ate 31/08, Madalena 14/09,
  Itapissuma 30/04, Jaboatao 23/04/2026; outras sem extrato. Nao ha outubro.
  O schema erp do financeiro esta vazio nos dois conjuntos financeiros conferidos;
  a consulta usa public, que tem os 34.992 lancamentos existentes.

## Proxima etapa com autorizacao de publicacao

1. Reconfirmar main/HEAD remoto para preservar eventuais mudancas do Claude.
2. Revisar/compilar e publicar SOMENTE a nova Edge Function. Manter verificacao
   de JWT e validacao de usuario/fin.acesso; nunca abrir chamada anonima.
3. Testar acesso real de Clarice/Urbano e negacao de usuario sem permissao/inativo.
4. Validar TCP/TLS, role efetiva e valores de um mes/empresa contra fonte real.
5. Publicar HTML + contas-pagar.js + contas-pagar.css juntos. Preservar demais
   arquivos; nao incluir qa-cp ou credenciais. Fazer smoke test dos modulos atuais.
6. A atualizacao dos extratos e conciliacao contabil nao foram autorizadas aqui.
   Nao criar dados para fazer outubro/novembro parecerem completos.

## Reversao isolada

Antes de usar em producao, basta nao publicar os arquivos novos. Para suspender
o acesso tecnico ja criado, administrador pode executar ALTER ROLE
radar_cp_consulta NOLOGIN; para desfazer a integracao depois, remover somente
o menu/inclusoes cp e revogar o papel dedicado. Nao executar DROP OWNED global
nem remover tabelas, lancamentos, policies de outros papeis ou dados do IXC.
