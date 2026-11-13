# Handoff para o Codex - 12/11/2026

Resumo do que o Claude fez entre 11 e 12/11/2026 no Radar Hilink. Leia antes de mexer em Contas a pagar, Correios ou Oportunidades.

## Regras que continuam valendo
- Publicar (merge em `main`) só depois de a Clarice escrever "pode publicar". Antes disso, trabalhar em branch `claude/...` ou `codex/...` e dar push no branch.
- `git pull` antes de editar. Não copiar `RADAR_HILINK_NOVO.html` por cima da produção.
- Supabase do Radar: projeto `mdhexsdnavzforuahgxn`. Migrations com `create or replace` / `if not exists`; evitar `drop`.
- IXC: usuário da API (grupo 26) só consulta e lista. Exceção aprovada em 11/11: recurso `get_pix` com "listar" e "novo" (o IXC trata a busca do QR Code como cadastro). Não liberar nada além disso sem a Clarice.
- Nunca digitar senha ou token. Segredos só no Vault.
- Planilhas financeiras continuam sendo a fonte oficial. O Radar só lê e aponta; quem corrige é a Caroline.
- Contas a pagar: acesso só Clarice e Urbano (`fin.acesso`, `public.radar_cp_pode()`, `fin.exigir_acesso()`).

## 1. Correios / carnê - "sem Pix" (resolvido)
- Causa: o grupo 26 tinha perdido a permissão `get_pix`; o IXC respondia "Você não tem permissão..." e o Radar mostrava "sem pix".
- `ixc.correios_processar`: o erro do Pix agora lê `mensagem` ou `message` da resposta do IXC (mostra o motivo real).
- Permissão restaurada pela Clarice (arquivo de permissões importado).

## 2. Leitura diária das planilhas financeiras (nova)
- Apps Script na conta Google `clafaelpc@gmail.com` (projeto "Projeto sem título"), código em `scripts/radar-planilhas-financeiro.gs`. Gatilho diário às 6h (`instalarGatilho`). Só lê; a planilha Excel da Madalena é convertida numa cópia temporária que vai para a lixeira.
- Envia as abas de 2026 (colunas A a E) para a edge function `planilha-financeiro` (verify_jwt false). Autenticação: o token OAuth vai no CORPO (`token`), não em cabeçalho (cabeçalhos `x-google-*` são descartados). A função confere o e-mail pelo Drive (`/drive/v3/about`) contra `fin.planilha_remetente`.
- Tabelas: `fin.planilha_fonte` (6 planilhas), `fin.planilha_linha` (bloco `saida` e `retirada`), `fin.planilha_leitura` (log + `conferencia` por aba: soma das linhas x TOTAL DAS SAÍDAS).
- Parser: cabeçalho "VENC", "DATA..." ou "PREVIS..."; sinal da aba inteira decidido pelo sinal do TOTAL DAS SAÍDAS (abas antigas de Jaboatão têm saídas negativas). Retiradas da Madalena (colunas laterais) ainda não são lidas.
- Duas formas de saída na planilha: bloco de cima = saída do banco (TOTAL DAS SAÍDAS); bloco "REEMBOLSOS E RETIRADAS" = acertos com sócios e entre filiais. Hoje Agenda, Resumo e Caixa usam só o bloco de cima.

## 3. Contas a pagar - telas novas (publicadas)
Menu lateral: Contas a pagar com subpastas (`cpTab('...')` em `contas-pagar.js`). As abas no topo só aparecem em "Sistema antigo".
- **Agenda de pagamentos** (`pagamentos`): RPC `radar_cp_planilhas`. Itens com previsto e REALIZADO vazio, do mês anterior até +30 dias. Marca "Conferir" quando a observação diz pago por outra filial / agendado.
- **Resumo do mês** (`mes`): RPC `radar_cp_resumo(p_competencia)`. Por empresa, grupos (`fin.grupo_padrao`), conferência e últimos 6 meses.
- **Caixa projetado** (`caixa30`): RPC `radar_cp_caixa(p_dias)` e `radar_cp_saldo_informar`. Saldo de partida = último entre `fin.saldo_informado` e `fin.saldo_bancario`; entradas = boletos IXC a vencer (`ixc.radar_carga` tipo `receber_periodo`) por carteira (`fin.carteira_filial`) x % pago no mês anterior; saídas = planilhas; meses sem aba estimados pelo mês anterior no mesmo dia.
- **DRE gerencial** (`dre26`): RPC `radar_cp_dre(p_ano, p_empresa)`. Receita = `ixc.receita_mensal` (recebido no IXC) mapeada por `fin.filial_ixc_empresa` (filial 10 fora; 13 e 14 na Madalena só a partir de 01/09/2026). Despesas = planilhas pelo mês da aba, linhas pelo `dre_linha` do plano. Camaragibe fora. Bloco à parte "Saídas de caixa que não são despesa" (contas de ativo e passivo).
- **De/para** (`depara`): RPC `radar_cp_depara_lista` e `radar_cp_depara_definir`.
- **Sistema antigo** (`resumo`, `lancamentos`, `dre`, `razao`, `caixa`, `conciliacao`, `auditoria`): continua lendo o banco antigo via `contas-pagar-consulta`, com aviso "dados até abril/2026". O banco antigo (`ekgrzvmqptjnvmrgabmg`, plano gratuito) hibernou em 11/11 e foi reiniciado pela Clarice; pode hibernar de novo. Último lançamento lá: 14/09/2026 (importações manuais, nunca teve leitura diária).

## 4. De/para (plano de contas)
- `fin.plano_contas`: 240 contas copiadas do sistema antigo pela edge function `cp-importar-depara` (chamada interna com `x-carga-chave`). Conta nova criada pela Clarice: `6.2.1.03 Acordos e Indenizações Judiciais`.
- Classificação na view `fin.planilha_classificada`, nesta ordem: `fin.depara_manual` (escolha da Clarice, vale para todas as filiais) > `fin.depara_regra` (regex na descrição normalizada por `fin.norm_desc`, ou na seção) > histórico do sistema antigo (`fin.depara_norm`, ignorando `6.2.1.02`) > sem conta.
- O histórico antigo tem erros conhecidos (TOPVENDAS como Simples, FGTS/INSS em Diversas). Por isso as regras passam na frente e o que vem só do histórico aparece como "Revisar".
- Decisões da Clarice (12/11): financiamentos e empréstimos = passivo; compra NandoNet/Pablom = investimento (1.2.2.01); CDB = 1.1.1.03; imóvel e reforma = imobilizado; Acordo Claydson ASN = 6.2.1.03; Marcos Túlio = equipamentos de rede ativa (1.2.3.01); "Fatura mensal final vencimento" e "Antecipação cartão" = fatura do cartão (2.1.1.04). Cartões de crédito Santander em Recife, Jaboatão e Igarassu.
- Cobertura em 12/11: 97% do valor das saídas de 2026 com conta; ~215 descrições sem conta.

## 5. OPA / disparos de oportunidade
- Causa do "disparo sem retorno" de 11/11 (reativação NandoNet): no envio em massa foi usado o modelo `nandonet_contratos_inativos` com o fluxo `contratos_inativos` (feito para outro modelo, botão `confirmar_endereco`). O fluxo certo é `nandonet_contratos_inativos` (botão `ainda_moro_no_endereco`). Regra: fluxo com o mesmo nome do modelo.
- `ixc.oportunidades_exportacoes` ganhou `modelo_opa` e `fluxo_opa`; RPCs `radar_oportunidades_modelo` e `radar_oportunidades_fluxo`. Ao gerar arquivos o Radar pergunta modelo e fluxo e avisa se forem diferentes.
- `radar_op_ia_pendentes` devolve `lote`, `lista`, `modelo`, `fluxo`.
- Alerta da Visão geral enxuto ("Disparo sem retorno da equipe"). Na lista, botão "Gerar atividade" abre a escolha: chamar de volta (atendente) e/ou corrigir o fluxo (agenda da Talitha ou a própria, com prazo). Detalhes vão dentro da tarefa (`radar_agenda_talitha`, ação `criar`).

## 6. Outros
- Botão fixo de dados: "Carregar dados de HH:MM" só quando os dados prontos têm menos de 30 min; senão mostra "Atualizar todos os dados".
- Git local: o remote só buscava `main`; foi adicionado o refspec `+refs/heads/claude/*:refs/remotes/origin/claude/*`.

## 7. Auditoria semanal das planilhas (ativa)
- Função `fin.auditoria_semanal()` (security definer, sem acesso para anon/authenticated). Cron `fin-auditoria-semanal`, `0 11 * * 1` (segunda 8h de Brasília).
- Testes: vencido sem baixa (mês anterior em diante), total da aba x soma das linhas (última leitura de cada filial), descrição sem conta no de/para, "pago por/pela <filial>" sem lançamento pago com a mesma descrição na filial pagadora, planilha sem leitura há mais de 2 dias.
- Grava em `fin.auditoria_achados` (fonte `auditoria semanal`, refaz a rodada do dia se rodar de novo) e cria tarefa na agenda da Clarice (`radar_agenda.tarefas`, prazo +2 dias).
- O teste "pago por outra filial" compara pela descrição normalizada; se a filial pagadora lançar com outro nome, aparece como achado para conferir.

## Pendências (ordem combinada)
1. Mostrar os achados da auditoria numa subpasta de Contas a pagar.
2. Transferências entre filiais e bloco de reembolsos/retiradas (inclui retiradas da Madalena nas colunas laterais).
3. Detalhamento das faturas de cartão (hoje só o pagamento da fatura, fora da DRE).
4. Script de extratos no Drive (`scripts/radar-drive-apps-script.gs`) para o saldo entrar sozinho no Caixa.
5. Separar juros/multa na receita da DRE; depreciação.
6. Pauta pausada: descontos indevidos do Inmap (precisa permissão de listar `vd_saida_produtos` e `su_oss_assunto`).

## 8. Extratos e francesinhas (13/11, branch `claude/cp-extratos`)
- Tela "Extratos do banco" (Contas a pagar): envio de vários arquivos de uma vez (OFX, Excel do internet banking, planilha conciliada da Caroline, francesinha `COBST_..._FRA.TXT`). A conta sai do próprio arquivo; não há seleção manual.
- Edge function `banco-arquivos` (verify_jwt false; autentica o usuário do Radar por `fin.acesso` ou o script do Google por token OAuth + `fin.planilha_remetente`). Leitura em `parse.ts` (testável com tsx + xlsx 0.18.5).
  - `acao: gravar` lê e grava; quando vem do Radar, coloca o arquivo em `fin.banco_upload` com nome padrão `EXTRATO_{FILIAL}_{ag-conta}_{dd-mm-aaaa}_a_{dd-mm-aaaa}.ext` ou `FRANCESINHA_{FILIAL}_{ag-conta}_{dd-mm-aaaa}_aviso{n}.txt`.
  - `quais`, `pendentes`, `feito`: usados pelo script do Google.
- Banco: `fin.extrato_gravar` troca o DIA inteiro quando o arquivo novo tem mais movimentos que o Radar naquele dia (OFX e Excel do mesmo dia não duplicam). `radar_cp_extrato_importar` usa essa função. `fin.francesinha` + `fin.francesinha_titulo` (liquidações com juros, baixas, entradas; troca o aviso inteiro se chegar de novo). `fin.banco_arquivo` = arquivos do Drive já lidos. `fin.conta_bancaria.drive_nome` (IG = COHAB no Drive).
- Script do Google (`scripts/radar-planilhas-financeiro.gs`, projeto "Projeto sem título"): `lerBanco` grava no Drive a fila do Radar (HILINK - Documentos / {FILIAL} / EXTRATO|FRANCESINHA / {ANO}) e procura no Drive (API v3, nome com EXTRATO/COBST_/FRANCESINHA, modificado em 2026) o que ainda não foi lido. `instalarGatilhoBanco` = a cada 15 min.
- Alertas: `fin.alerta_extratos()`, cron `fin-alerta-extratos` (`0 12 * * 1-5`, 9h). Uma tarefa por conta na agenda da Caroline quando o extrato não cobre até o dia útil anterior (ou a francesinha atrasa 2 dias úteis, só para contas que já têm francesinha). Atualiza a mesma tarefa enquanto aberta e fecha sozinha quando o arquivo chega.
- Próximo uso da francesinha: separar juros/multa da receita da DRE (`francesinha_titulo.juros`, `seu_numero` = id do boleto no IXC) e conferir o crédito "COB BLOQ COMP" do extrato com a soma das liquidações.
