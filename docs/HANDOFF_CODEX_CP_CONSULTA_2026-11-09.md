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
- Base efetivamente conferida antes de publicar: main 5950c00d5626fc4b5652236a8093fcac4fa68c26.
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

## Atualizacao: publicacao autorizada em 09/11/2026

Clarice autorizou publicar e informou que Claude esta ausente ate quarta.
Esta secao atualiza os estados preparatorios descritos acima.

- Nova Edge Function contas-pagar-consulta publicada no Radar: ACTIVE, versao 1,
  verify_jwt=true; nenhuma outra Edge Function substituida.
- Commit 75bb535 publicado em main. GitHub Pages concluiu build/deploy com sucesso.
- Teste real usando a sessao ja aberta de Clarice: menu, acesso, consulta por
  competencia em novembro e outubro, e achados registrados na Auditoria.
- O agregado de novembro exibido na tela foi comparado com SELECT independente
  na fonte e coincidiu. Valores detalhados nao foram publicados neste documento.
- TCP/TLS e uso da credencial do Vault funcionaram pelo servidor em producao.
- Chamada sem autenticacao retornou HTTP 401. Casos de usuario inativo/sem
  autorizacao continuam testados localmente; nao houve troca de cadastro ou
  criacao de sessao falsa para testar usuarios reais.
- DRE/caixa continuam parciais, extratos continuam com a cobertura antiga.
- Ajustes posteriores: formato da data da rodada, trilha de navegacao e ocultacao
  dos selos genericos de processamento local/multicampanha dentro deste modulo.
- Sem pagamentos, alteracoes de lancamentos, conciliacoes, cron ou escrita IXC.

## Informacoes gerais: solicitacao adicional de Clarice

- Hierarquia: Planos e beneficios; Taxas e servicos; Vencimentos e pagamento;
  Aplicativo e canais do cliente; Procedimentos e padroes; Acessos tecnicos.
- Mesh/aplicativos adicionais e materiais reunidos sob Taxas e servicos, com
  subtitulos distintos para taxa e adicional mensal. Dados e precos anteriores
  preservados; campos de edicao existentes continuam funcionando.
- Informacao regional adicionada no Supabase do Radar, chave principal de
  radar_info_geral: instalacao de R$ 150,00 + pre-pago do plano apenas na area de
  Itamaraca da filial 5 (Hilink Igarassu). Nenhum cadastro/titulo do IXC alterado.
- O texto geral que prometia instalacao gratuita foi ajustado para conter essa
  excecao; evita contradicao tambem no texto de plano copiado para o cliente.
- Novo objeto dados.cobranca com vencimentos 5, 10, 15, 20 e 25, orientacao para
  sabado/domingo/feriado e mensagem pronta. O adiamento so vale no mes afetado;
  dia escolhido continua nos meses seguintes. Nao ha calculo de feriados/data
  especifica nem alteracao automatica de vencimentos de boletos.
- Mensagem pode ser copiada e editada pela gestao no editor existente. Nao foi
  acrescentada promessa sobre juros, multa ou condicoes nao informadas.
- Backup local dos tres campos alterados (sem acessos/senhas):
  C:\Hilink\RADAR HILINK\outputs\INFO_GERAIS_2026-11-09_ANTES.json.
- scripts/test-informacoes.cjs verifica agrupamento do Mesh, escopo regional,
  datas, texto copiado, busca e edicao sem alterar o original antes de Salvar,
  desktop/mobile. As fixtures nao contem acessos/senhas reais.

### Complemento solicitado por Clarice durante a publicacao

- Regra de instalacao agora tem aviso destacado no grupo Planos e beneficios:
  gratuita, exceto Itamaraca, com filial 5 / Hilink Igarassu e taxa + pre-pago.
- Produtos avulsos (dentro de Taxas e servicos) inclui Fonte 12V por R$ 20,00.
  Demais produtos/precos, planos, Mesh e taxas anteriores foram preservados.
- A pedido de Clarice, removidos da base ativa dados.videos,
  dados.beneficios_video_geral e campo video dos objetos dados.beneficios.
  Nenhum arquivo fisico do repositorio foi apagado e nada foi alterado no Opa!.
- Inclusa orientacao curta: abrir Mensagens rapidas no chat do Opa!, procurar
  aplicativo, selecionar video disponivel, conferir/ajustar texto e anexo e enviar.
- Procedimento de ativacao PlayHub atualizado apenas no passo de envio do video;
  links de cadastro PlayHub e Portal do Assinante foram mantidos.
- Editor nao oferece mais campos de video; orientacao do Opa! segue editavel.
- Backup local dos campos afetados, sem acessos/senhas:
  C:\Hilink\RADAR HILINK\outputs\INFO_GERAIS_VIDEOS_2026-11-09_ANTES.json.
- Teste ampliado: destaque regional, Fonte no grupo correto e ausencia de links
  mp4 na tela mesmo se o cliente receber objeto antigo em cache.

### Compactacao solicitada depois da primeira publicacao

- Taxas e servicos em duas colunas no desktop: Servicos a esquerda (Mesh,
  aplicativos, mudanca e instalacao) e Produtos a direita. Valores e unidades
  preservados; adicionais mensais continuam identificados por mes/ponto/app.
- Em celular, uma coluna para evitar sobreposicao ou corte de texto.
- Vencimentos, observacao complementar e Copiar mensagem na mesma faixa no
  desktop. Removido o bloco repetido Mensagem para o cliente. Texto completo
  continua no campo editavel da gestao e no conteudo copiado.
- Regra curta atualizada em dados.cobranca.regra_dia_nao_util, sem alterar os
  dias contratados ou dados.cobranca.texto_cliente.
- Testes verificam alinhamento das duas colunas e da faixa, copia e mobile.
- Caso de titulo nao liberado levantado por Clarice: consulta apenas, sem
  cancelar/liberar/receber no IXC e sem ocultar alerta. Evidencias privadas em
  C:\Hilink\RADAR HILINK\outputs\CHECAGEM_TITULO_NAO_LIBERADO_2026-11-09.md.

### Posicao da nota de Itamaraca

- A pedido de Clarice, o destaque foi movido para o proprio item Instalacao em
  Todo plano inclui. Removida a faixa separada acima desse grupo.
- Preservados o destaque visual, filial 5, R$ 150,00 + pre-pago e os demais itens.
- Sem alteracao de banco ou de regras; teste exige um unico destaque, dentro
  da grade de inclusos, com os quatro itens preservados.
