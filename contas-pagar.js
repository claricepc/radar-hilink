/* Read-only financial consultation. No browser financial cache or mutation API. */
(()=>{
  'use strict';
  const NOVAS={pagamentos:['Agenda de pagamentos','o que vence, lido das planilhas todo dia'],mes:['Resumo do mês','previsto, pago e vencido sem baixa'],caixa30:['Caixa projetado','próximos 30 dias por empresa'],dre26:['DRE gerencial','resultado por empresa e consolidado'],depara:['De/para (plano de contas)','ligação das descrições às contas']};
  const tabs={resumo:'Resumo',lancamentos:'Lançamentos',dre:'DRE',razao:'Razão',caixa:'Caixa',conciliacao:'Conciliação',auditoria:'Auditoria'};
  const now=new Date(),pad=n=>String(n).padStart(2,'0');
  const local=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const state={view:'pagamentos',filialAg:'',de:local(new Date(now.getFullYear(),now.getMonth(),1)),ate:local(now),empresa:null,pagina:1,status:'todos',regime:'competencia'};
  let generation=0,controller=null,identity=null,authorized=false,last=null;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>v===null||v===undefined?'Não disponível':Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const date=v=>v?String(v).slice(0,10).split('-').reverse().join('/'):'Não informado';
  const box=()=>document.getElementById('mod-cp');
  const msg=t=>`<div class="cp-empty" role="status">${esc(t)}</div>`;
  function clear(){generation++;controller?.abort();controller=null;last=null;if(box())box().replaceChildren();}
  async function visibility(){
    const sb=getSB();if(!sb)return;
    const {data}=await sb.auth.getUser();
    const user=data?.user;
    if(identity!==user?.id){clear();authorized=false;identity=user?.id||null;}
    const before=identity;
    const r=user?await sb.rpc('radar_cp_pode'):{data:false};
    if(before!==identity)return;
    authorized=!r.error&&r.data===true;
    const group=document.getElementById('cp-nav');if(group)group.hidden=!authorized;
    if(!authorized){clear();if(document.body.dataset.activeMod==='cp')box().innerHTML=msg('Acesso restrito à gestão autorizada.');}
  }
  function shell(){
    const b=box();if(!b)return;
    const nova=NOVAS[state.view];
    b.innerHTML=`<div class="cp-head"><div><h2>${nova?nova[0]:'Sistema antigo (até abril/2026)'}</h2><p>${nova?nova[1]:'consulta ao financeiro antigo, somente leitura'}</p></div>${nova?'':'<span class="cp-mode">Somente leitura</span>'}</div>
      <form class="cp-filters" id="cp-form"><label>De<input id="cp-de" type="date" min="2026-01-01" value="${state.de}" required></label>
      <label>Até<input id="cp-ate" type="date" min="2026-01-01" value="${state.ate}" required></label>
      <label>Empresa<select id="cp-empresa"><option value="">Todas autorizadas</option></select></label>
      <label id="cp-regime-label">Período por<select id="cp-regime"><option value="competencia">Competência</option><option value="caixa">Pagamento</option></select></label>
      <label id="cp-status-label">Situação<select id="cp-status"><option value="todos">Todas</option><option value="PAGO">Pago</option><option value="PROVISIONADO">Provisionado</option></select></label>
      <button type="submit">Consultar</button></form>
      <div class="cp-tabs" role="tablist" aria-label="Sistema antigo"${nova?' hidden':''}>${Object.entries(tabs).map(([id,label])=>`<button type="button" role="tab" data-view="${id}" aria-selected="${id===state.view}">${label}</button>`).join('')}</div>
      <div id="cp-context"></div><div id="cp-result" aria-live="polite"></div><div id="cp-coverage"></div>`;
    b.querySelector('#cp-regime').value=state.regime;b.querySelector('#cp-status').value=state.status;
    b.querySelector('#cp-form').onsubmit=e=>{e.preventDefault();state.de=b.querySelector('#cp-de').value;state.ate=b.querySelector('#cp-ate').value;state.empresa=b.querySelector('#cp-empresa').value||null;state.regime=b.querySelector('#cp-regime').value;state.status=b.querySelector('#cp-status').value;state.pagina=1;load();};
    b.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{state.view=button.dataset.view;state.pagina=1;load();});
  }
  const labels={id:'Identificador',filial:'Empresa',descricao:'Descrição',data_competencia:'Competência',data_vencimento:'Vencimento',data_pagamento:'Pagamento',conta_codigo:'Conta contábil',status:'Situação',valor_previsto:'Previsto',valor_realizado:'Realizado',pago_por:'Pago por (origem)',liquidacao:'Liquidação',origem:'Fonte',grupo:'Grupo DRE',registros:'Registros',previsto:'Previsto',realizado:'Realizado',data_lancamento:'Data',numero:'Número',historico:'Histórico',lado:'Débito / crédito',valor:'Valor',historico_item:'Detalhe',data_transacao:'Data do extrato',descricao_banco:'Histórico bancário',tipo_movimento:'Tipo',status_conc:'Conciliação registrada',lancamento_id:'Lançamento vinculado',origem_arquivo:'Arquivo de origem',filial_conta:'Empresa da conta',alerta:'Ponto a conferir'};
  const amounts=new Set(['valor','valor_previsto','valor_realizado','previsto','realizado']);
  Object.assign(labels,{rodada:'Rodada',competencia:'Mês',teste:'Verificação registrada',linha:'Linha na fonte',valor_lancado:'Valor lançado (registro)',valor_correto:'Valor correto (registro)',diferenca:'Diferença registrada',fonte:'Fonte',observacao:'Observação'});
  ['valor_lancado','valor_correto','diferenca'].forEach(k=>amounts.add(k));
  function table(rows){
    if(!rows.length)return msg('Nenhum registro localizado neste recorte. Isso não confirma ausência de despesas: confira a cobertura da fonte.');
    const keys=Object.keys(rows[0]).filter(k=>k in labels);
    return `<div class="cp-table"><table><thead><tr>${keys.map(k=>`<th scope="col">${labels[k]}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${keys.map(k=>`<td class="${amounts.has(k)?'cp-number':''}">${esc(amounts.has(k)?money(row[k]):k.startsWith('data_')||k==='rodada'?date(row[k]):row[k]??'Não informado')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function display(data){
    const b=box();if(!b)return;
    last=data;
    const company=b.querySelector('#cp-empresa');company.innerHTML='<option value="">Todas autorizadas</option>'+(data.empresas||[]).map(e=>`<option value="${esc(e.id)}">${esc(e.codigo)}</option>`).join('');company.value=state.empresa||'';
    let html='';
    if(state.view==='resumo'){
      const s=data.resumo||{};
      html=`<div class="cp-stats">${[['Registros',s.registros??'Não disponível'],['Despesa prevista',money(s.previsto)],['Realizado (status pago)',money(s.realizado)],['Sem classificação',s.sem_classificacao??'Não disponível']].map(([name,v])=>`<div class="cp-stat"><span>${name}</span><strong>${esc(v)}</strong></div>`).join('')}</div><p>Realizado sem data de pagamento: ${esc(s.realizado_sem_data??'Não disponível')}. Consulte Auditoria para localizar os registros.</p>`;
    }else html=table(data.rows||[]);
    if(state.view==='auditoria')html=`<h3>Pontos a conferir na base financeira</h3>${html}<h3>Achados já registrados no Radar</h3><p>Registro anterior de auditoria. Não foi revalidado automaticamente nesta consulta. Filial TODAS indica achado geral.</p>${table(data.registrados||[])}${data.registrados_limitados?'<p>Exibidos os primeiros 100 achados registrados.</p>':''}`;
    if(data.total>50||data.mais||state.pagina>1)html+=`<div class="cp-pagination"><button id="cp-prev" ${state.pagina===1?'disabled':''}>Anterior</button><span>Página ${state.pagina}${data.total!==null?' · '+data.total+' registros':''}</span><button id="cp-next" ${data.mais||(data.total>state.pagina*50)?'':'disabled'}>Próxima</button></div>`;
    b.querySelector('#cp-result').innerHTML=html;
    const prev=b.querySelector('#cp-prev'),next=b.querySelector('#cp-next');
    if(prev)prev.onclick=()=>{state.pagina--;load();};if(next)next.onclick=()=>{state.pagina++;load();};
    const notes={agenda:'Agenda por vencimento, apenas despesas provisionadas. Registros sem vencimento não aparecem nesta lista.',dre:'DRE parcial: somente despesas classificadas. Não representa lucro, fechamento aprovado ou DRE completa.',razao:'Razão dos lançamentos efetivados na fonte. Não representa fechamento aprovado.',caixa:'Movimentos do extrato. Saldo bancário validado indisponível: não foi calculado por soma destas linhas.',conciliacao:'Exibe a conciliação registrada na fonte. Esta tela não concilia, corrige nem confirma diferenças.',auditoria:'Candidatos à revisão, não erros confirmados. Localize o identificador e o arquivo de origem no financeiro e confira o comprovante, a classificação e a data antes de decidir.'};
    b.querySelector('#cp-context').innerHTML=`<div class="cp-notice cp-antigo"><b>Sistema financeiro antigo:</b> dados importados até abril/2026 (extratos da Madalena até 14/09/2026). Não é atualizado. Para o que vence agora, use a aba Agenda de pagamentos.</div><p>Fonte: ${esc(data.fonte)} · Consulta: ${esc(new Date(data.consultado_em).toLocaleString('pt-BR'))} · ${date(state.de)} a ${date(state.ate)} · ${state.view==='agenda'?'Vencimento':['razao','caixa','conciliacao','auditoria'].includes(state.view)?'Data própria da aba':state.regime==='caixa'?'Pagamento':'Competência'}</p>${notes[state.view]?`<div class="cp-notice">${notes[state.view]}</div>`:''}`;
    const coverage=(data.empresas||[]).filter(e=>!state.empresa||e.id===state.empresa);
    const coverageRows=coverage.map(e=>({filial:e.codigo,data_transacao:e.extrato_ate,alerta:!e.extrato_ate?'Sem extrato desde 2026':String(e.extrato_ate).slice(0,10)<state.ate?'Extrato não cobre todo o período solicitado':'Conferir abrangência dos arquivos de origem'}));
    b.querySelector('#cp-coverage').innerHTML=`<details><summary>Cobertura da fonte por empresa</summary><p>Última competência pode incluir previsão futura. Ela não comprova atualização bancária.</p>${table(coverageRows)}</details>`;
    if(coverage.some(e=>!e.extrato_ate||String(e.extrato_ate).slice(0,10)<state.ate))b.querySelector('#cp-context').insertAdjacentHTML('beforeend','<div class="cp-notice">Cobertura bancária incompleta neste período. Não use esta consulta como fechamento definitivo.</div>');
  }

  const ATRASO=['Atrasados','Vencem hoje','Próximos 7 dias','Depois'];
  const outraFilial=t=>/PAGO\s+(POR|PELA|PELO|NO)\b|AGENDAD/i.test(String(t||''));

  const MESN=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  const mesTxt=c=>{const [a,m]=String(c).slice(0,7).split('-');return MESN[+m-1]+'/'+a.slice(2);};
  const m0=v=>v==null?'-':Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0});
  async function loadMes(own){
    const b=box();if(!b)return;
    b.querySelector('#cp-form').style.display='none';
    b.querySelectorAll('[data-view]').forEach(el=>el.setAttribute('aria-selected',String(el.dataset.view===state.view)));
    b.querySelector('#cp-result').innerHTML=msg('Montando o resumo do mês a partir das planilhas…');b.querySelector('#cp-context').replaceChildren();b.querySelector('#cp-coverage').replaceChildren();
    const {data,error}=await getSB().rpc('radar_cp_resumo',state.compMes?{p_competencia:state.compMes}:{});
    if(own!==generation||!box())return;
    if(error){b.querySelector('#cp-result').innerHTML=msg('Resumo indisponível: '+error.message);return;}
    paintMes(data);
  }
  function paintMes(d){
    const b=box();if(!b)return;
    const F=d.filiais||[], G=d.grupos||[], E=d.evolucao||[];
    const sum=k=>F.reduce((t,f)=>t+Number(f[k]||0),0);
    const prev=sum('previsto'), pago=sum('pago'), aberto=sum('em_aberto'), atras=sum('atrasado'), atrN=sum('atrasado_itens');
    const pct=(a,t)=>t?Math.round(a/t*100)+'%':'-';
    const sel=`<label class="cp-mes-sel">Mês <select id="cp-mes">${(d.meses||[]).map(c=>`<option value="${c}"${String(c).slice(0,7)===String(d.competencia).slice(0,7)?' selected':''}>${mesTxt(c)}</option>`).join('')}</select></label>`;
    let h=`<div class="cp-mes-top">${sel}</div>
    <div class="cp-stats">
      <div class="cp-stat"><span>Previsto no mês</span><strong>${m0(prev)}</strong></div>
      <div class="cp-stat"><span>Já pago</span><strong>${m0(pago)} · ${pct(pago,prev)}</strong></div>
      <div class="cp-stat"><span>Em aberto</span><strong>${m0(aberto)}</strong></div>
      <div class="cp-stat${atras?' cp-alerta':''}"><span>Vencido sem baixa</span><strong>${atrN} · ${m0(atras)}</strong></div>
    </div>`;
    h+=`<h3 class="cp-h">Por empresa</h3><div class="cp-table"><table><thead><tr><th>Empresa</th><th class="cp-number">Previsto</th><th class="cp-number">Pago</th><th class="cp-number">Em aberto</th><th class="cp-number">Vencido sem baixa</th><th class="cp-number">Retiradas e reembolsos</th><th>Conferência com a planilha</th></tr></thead><tbody>${F.map(f=>{const c=f.conferencia;const ok=c&&c.confere;const dif=c&&!c.confere?(c.total_previsto!=null&&Math.abs((c.soma_previsto||0)-(c.total_previsto||0))>=.05?`Soma das linhas ${m0(c.soma_previsto)} x TOTAL DAS SAÍDAS ${m0(c.total_previsto)}`:`Pago: soma ${m0(c.soma_realizado)} x total ${m0(c.total_realizado)}`):'';
      return `<tr><td>${esc(f.filial)}</td><td class="cp-number">${m0(f.previsto)}</td><td class="cp-number">${m0(f.pago)}</td><td class="cp-number">${m0(f.em_aberto)}</td><td class="cp-number">${f.atrasado_itens?`${f.atrasado_itens} · ${m0(f.atrasado)}`:'-'}</td><td class="cp-number">${m0(f.retiradas)}</td><td>${!c?'Sem leitura':ok?'<span class="cp-ok">Confere</span>':`<span class="cp-dif">Não confere</span><br><small>${esc(dif)}</small>`}</td></tr>`;}).join('')}
      <tr class="cp-total"><td>Total</td><td class="cp-number">${m0(prev)}</td><td class="cp-number">${m0(pago)}</td><td class="cp-number">${m0(aberto)}</td><td class="cp-number">${atrN?`${atrN} · ${m0(atras)}`:'-'}</td><td class="cp-number">${m0(sum('retiradas'))}</td><td></td></tr></tbody></table></div>`;
    const maxG=Math.max(1,...G.map(g=>Number(g.previsto||0)));
    h+=`<h3 class="cp-h">Para onde vai o dinheiro</h3><div class="cp-barras">${G.map(g=>`<div class="cp-barra"><div class="cp-barra-rot">${esc(g.grupo)}</div><div class="cp-barra-trilho"><i style="width:${Math.max(1,Number(g.previsto||0)/maxG*100)}%"></i><b style="width:${Math.max(0,Number(g.pago||0)/maxG*100)}%"></b></div><div class="cp-barra-val">${m0(g.previsto)} <small>${pct(g.previsto,prev)} do mês</small></div></div>`).join('')}</div>
      <p class="cp-legenda"><i class="cp-l-prev"></i> previsto <b class="cp-l-pago"></b> já pago</p>`;
    const meses=[...new Set(E.map(e=>String(e.competencia).slice(0,10)))].sort(), fils=[...new Set(E.map(e=>e.filial))];
    const val=(m,f)=>{const e=E.find(x=>String(x.competencia).slice(0,10)===m&&x.filial===f);return e?Number(e.previsto||0):0;};
    h+=`<h3 class="cp-h">Últimos meses (previsto)</h3><div class="cp-table"><table><thead><tr><th>Empresa</th>${meses.map(m=>`<th class="cp-number">${mesTxt(m)}</th>`).join('')}</tr></thead><tbody>${fils.map(f=>`<tr><td>${esc(f)}</td>${meses.map(m=>`<td class="cp-number">${m0(val(m,f))}</td>`).join('')}</tr>`).join('')}<tr class="cp-total"><td>Total</td>${meses.map(m=>`<td class="cp-number">${m0(fils.reduce((t,f)=>t+val(m,f),0))}</td>`).join('')}</tr></tbody></table></div>`;
    b.querySelector('#cp-result').innerHTML=h;
    b.querySelector('#cp-mes').onchange=e=>{state.compMes=e.target.value;load();};
    b.querySelector('#cp-context').innerHTML=`<div class="cp-notice">Fonte: planilhas de fluxo de caixa de cada filial, lidas a cada edição e conferidas todo dia às 6h. A tela se atualiza sozinha. "Pago" é a coluna REALIZADO. "Vencido sem baixa" é o que tem previsto, já venceu e está com o REALIZADO vazio: ou está atrasado, ou foi pago e falta marcar na planilha. "Conferência" compara a soma das linhas com o TOTAL DAS SAÍDAS da própria planilha; quando não confere, a fórmula do total pode não estar pegando todas as linhas.</div>`;
  }

  async function loadCaixa(own){
    const b=box();if(!b)return;
    b.querySelector('#cp-form').style.display='none';
    b.querySelectorAll('[data-view]').forEach(el=>el.setAttribute('aria-selected',String(el.dataset.view===state.view)));
    b.querySelector('#cp-result').innerHTML=msg('Projetando o caixa dos próximos 30 dias…');b.querySelector('#cp-context').replaceChildren();b.querySelector('#cp-coverage').replaceChildren();
    const {data,error}=await getSB().rpc('radar_cp_caixa',{p_dias:30});
    if(own!==generation||!box())return;
    if(error){b.querySelector('#cp-result').innerHTML=msg('Caixa indisponível: '+error.message);return;}
    paintCaixa(data);
  }
  function caixaGrafico(F){
    const dias=(F[0]?.serie||[]).map(x=>x.dia); if(!dias.length) return '';
    const tot=dias.map((_,i)=>F.reduce((t,f)=>t+Number(f.serie?.[i]?.saldo||0),0));
    const W=900,H=200,P=36, mn=Math.min(0,...tot), mx=Math.max(...tot,1);
    const X=i=>P+i*(W-2*P)/Math.max(1,dias.length-1), Y=v=>H-P-(v-mn)/(mx-mn||1)*(H-2*P);
    const pts=tot.map((v,i)=>`${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
    const z=Y(0), iMin=tot.indexOf(Math.min(...tot));
    return `<svg class="cp-graf" viewBox="0 0 ${W} ${H}" role="img" aria-label="Saldo projetado somando as cinco empresas">
      <line x1="${P}" x2="${W-P}" y1="${z}" y2="${z}" class="cp-g-zero"/>
      <polyline points="${pts}" class="cp-g-linha"/>
      <circle cx="${X(iMin)}" cy="${Y(tot[iMin])}" r="5" class="${tot[iMin]<0?'cp-g-neg':'cp-g-pt'}"/>
      <text x="${X(iMin)}" y="${Y(tot[iMin])-10}" text-anchor="middle" class="cp-g-txt">menor: ${m0(tot[iMin])} em ${date(dias[iMin]).slice(0,5)}</text>
      <text x="${P}" y="${H-8}" class="cp-g-txt">${date(dias[0]).slice(0,5)}</text><text x="${W-P}" y="${H-8}" text-anchor="end" class="cp-g-txt">${date(dias[dias.length-1]).slice(0,5)}</text>
      <text x="${W-P}" y="${Y(tot[tot.length-1])-8}" text-anchor="end" class="cp-g-txt">${m0(tot[tot.length-1])}</text></svg>`;
  }
  function paintCaixa(d){
    const b=box();if(!b)return;
    const F=d.filiais||[], hoje=d.hoje;
    const velho=F.some(f=>!f.saldo_data||f.saldo_data<hoje);
    const minDe=f=>{let m=null;(f.serie||[]).forEach(x=>{if(m===null||Number(x.saldo)<Number(m.saldo))m=x;});return m||{};};
    let h='';
    if(velho)h+=`<div class="cp-notice cp-antigo"><b>Atenção:</b> o saldo de partida é o último que o Radar conhece (veja a data em cada empresa). Pagamentos e recebimentos entre essa data e hoje não entram na conta. Informe o saldo de hoje abaixo para a projeção ficar certa.</div>`;
    h+=`<div class="cp-graf-box"><h3 class="cp-h" style="margin-top:4px">Saldo projetado, somando as cinco empresas</h3>${caixaGrafico(F)}</div>`;
    h+=`<h3 class="cp-h">Por empresa, próximos 30 dias</h3><div class="cp-table"><table><thead><tr><th>Empresa</th><th>Saldo de partida</th><th class="cp-number">Entradas prováveis</th><th class="cp-number">Saídas</th><th class="cp-number">Saldo em 30 dias</th><th>Menor saldo</th><th>Informar saldo de hoje</th></tr></thead><tbody>${F.map(f=>{const mn=minDe(f), fim=(f.serie||[]).slice(-1)[0]||{};
      return `<tr><td><b>${esc(f.filial)}</b><br><small>${f.vencido_n?`${f.vencido_n} vencidos sem baixa: ${m0(f.vencido_valor)}`:''}</small></td>
      <td>${m0(f.saldo)}<br><small class="${f.saldo_data<hoje?'cp-dif':''}">em ${date(f.saldo_data)}</small></td>
      <td class="cp-number">${m0(f.entradas)}<br><small>${m0(f.entradas_bruto)} a vencer × ${String(f.taxa).replace('.',',')}% pagos no mês passado</small></td>
      <td class="cp-number">${m0(f.saidas)}${Number(f.saidas_estimadas)?`<br><small>${m0(f.saidas_estimadas)} estimados pelo mês anterior</small>`:''}</td>
      <td class="cp-number"><b class="${Number(fim.saldo)<0?'cp-dif':''}">${m0(fim.saldo)}</b></td>
      <td class="${Number(mn.saldo)<0?'cp-dif':''}">${m0(mn.saldo)}<br><small>em ${date(mn.dia)}</small></td>
      <td><div class="cp-saldo-in"><input type="text" inputmode="decimal" placeholder="0,00" data-saldo="${esc(f.filial)}" aria-label="Saldo de hoje ${esc(f.filial)}"><button type="button" class="cp-btn" data-salvar="${esc(f.filial)}">Salvar</button></div></td></tr>`;}).join('')}</tbody></table></div>`;
    const neg=F.flatMap(f=>(f.serie||[]).filter(x=>Number(x.saldo)<0).slice(0,1).map(x=>({f:f.filial,...x})));
    if(neg.length)h+=`<div class="cp-notice" style="border-color:#d9534f;background:#fff4f4;color:#7a1c19"><b>Risco de caixa negativo:</b> ${neg.map(n=>`${esc(n.f)} a partir de ${date(n.dia)} (${m0(n.saldo)})`).join('; ')}. Antecipe recebimentos, transfira entre empresas ou renegocie o vencimento antes dessa data.</div>`;
    b.querySelector('#cp-result').innerHTML=h;
    b.querySelectorAll('[data-salvar]').forEach(bt=>bt.onclick=async()=>{
      const fil=bt.dataset.salvar, inp=b.querySelector(`[data-saldo="${fil}"]`);
      const v=Number(String(inp.value).replace(/\./g,'').replace(',','.').replace(/[^0-9.-]/g,''));
      if(!inp.value.trim()||!isFinite(v)){inp.focus();return;}
      bt.disabled=true;bt.textContent='Salvando…';
      const {error}=await getSB().rpc('radar_cp_saldo_informar',{p_filial:fil,p_data:hoje,p_saldo:v});
      if(error){bt.disabled=false;bt.textContent='Salvar';alert('Não salvou: '+error.message);return;}
      load();
    });
    b.querySelector('#cp-context').innerHTML=`<div class="cp-notice">Como a conta é feita: saldo de partida + boletos do IXC a vencer em cada dia (pela carteira de cada empresa), multiplicados pelo percentual que foi pago no mês passado, menos as saídas da planilha ainda sem REALIZADO. Para os meses que ainda não têm aba na planilha, as saídas são estimadas repetindo as contas do mês anterior no mesmo dia. Os vencidos sem baixa não entram na projeção: confira se já foram pagos.</div>`;
  }

  const ORIG={manual:'Definido por você',regra:'Regra automática',historico_filial:'Sistema antigo (revisar)',historico_geral:'Sistema antigo (revisar)'};
  async function loadDepara(own){
    const b=box();if(!b)return;
    b.querySelector('#cp-form').style.display='none';
    b.querySelectorAll('[data-view]').forEach(el=>el.setAttribute('aria-selected',String(el.dataset.view===state.view)));
    b.querySelector('#cp-result').innerHTML=msg('Carregando o de/para…');b.querySelector('#cp-context').replaceChildren();b.querySelector('#cp-coverage').replaceChildren();
    const {data,error}=await getSB().rpc('radar_cp_depara_lista');
    if(own!==generation||!box())return;
    if(error){b.querySelector('#cp-result').innerHTML=msg('De/para indisponível: '+error.message);return;}
    state.dp=data; state.dpFiltro=state.dpFiltro||'pendentes'; paintDepara();
  }
  function paintDepara(){
    const b=box(), d=state.dp; if(!b||!d)return;
    const R=d.resumo||{}, C=d.contas||[], busca=(state.dpBusca||'').toUpperCase();
    const pct=(a,t)=>t?Math.round(a/t*1000)/10+'%':'-';
    const filtros={pendentes:['Sem conta',1],revisar:['Revisar (sistema antigo)',2],todos:['Todos',0]};
    let it=(d.itens||[]).filter(x=>state.dpFiltro==='todos'||x.situacao===filtros[state.dpFiltro][1]);
    if(busca) it=it.filter(x=>(x.desc_norm+' '+(x.exemplo||'')).toUpperCase().includes(busca));
    const nome=c=>{const k=C.find(x=>x.codigo===c);return k?`${k.codigo} ${k.descricao}`:'';};
    const opts=sel=>`<option value="">Escolha a conta</option>${C.map(c=>`<option value="${esc(c.codigo)}"${c.codigo===sel?' selected':''}>${esc(c.codigo+' '+c.descricao)}</option>`).join('')}`;
    let h=`<div class="cp-stats">
      <div class="cp-stat"><span>Valor de 2026 classificado</span><strong>${pct(R.classificado,R.total)}</strong></div>
      <div class="cp-stat"><span>Por regra ou por você</span><strong>${pct(R.confirmado,R.total)}</strong></div>
      <div class="cp-stat${R.pendentes?' cp-alerta':''}"><span>Descrições sem conta</span><strong>${R.pendentes||0}</strong></div>
      <div class="cp-stat"><span>Vindas do sistema antigo, a revisar</span><strong>${R.revisar||0}</strong></div></div>
      <div class="cp-chips">${Object.entries(filtros).map(([k,[t]])=>`<button type="button" data-dpf="${k}" aria-pressed="${state.dpFiltro===k}">${t}</button>`).join('')}
      <input type="search" id="cp-dp-busca" placeholder="Buscar descrição" value="${esc(state.dpBusca||'')}" style="margin-left:auto;padding:5px 10px;border:1px solid #c9d3e3;border-radius:8px"></div>`;
    h+=`<div class="cp-table"><table><thead><tr><th>Descrição na planilha</th><th>Empresas</th><th class="cp-number">Vezes</th><th class="cp-number">Valor 2026</th><th>Conta</th><th></th></tr></thead><tbody>${it.slice(0,300).map((x,i)=>`<tr>
      <td><b>${esc(x.exemplo||x.desc_norm)}</b><br><small>${esc(x.secao||'')}</small></td><td><small>${esc(x.filiais)}</small></td>
      <td class="cp-number">${x.ocorrencias}</td><td class="cp-number">${m0(x.valor)}</td>
      <td><select data-dpsel="${i}" style="max-width:340px">${opts(x.conta_codigo)}</select><br><small>${x.conta_codigo?esc(ORIG[x.origem]||''):'Sem conta'}</small></td>
      <td><button type="button" class="cp-btn" data-dpsave="${i}">Salvar</button></td></tr>`).join('')}</tbody></table></div>
      ${it.length>300?`<p class="cp-legenda">Mostrando 300 de ${it.length}. Use a busca para achar os demais.</p>`:''}${!it.length?msg('Nada neste filtro.'):''}`;
    b.querySelector('#cp-result').innerHTML=h;
    b.querySelectorAll('[data-dpf]').forEach(x=>x.onclick=()=>{state.dpFiltro=x.dataset.dpf;paintDepara();});
    const bs=b.querySelector('#cp-dp-busca'); bs.oninput=()=>{state.dpBusca=bs.value;clearTimeout(state.dpT);state.dpT=setTimeout(()=>{paintDepara();const n=box()?.querySelector('#cp-dp-busca');if(n){n.focus();n.setSelectionRange(n.value.length,n.value.length);}},350);};
    b.querySelectorAll('[data-dpsave]').forEach(bt=>bt.onclick=async()=>{
      const x=it[+bt.dataset.dpsave], conta=b.querySelector(`[data-dpsel="${bt.dataset.dpsave}"]`).value;
      if(!conta)return; bt.disabled=true; bt.textContent='Salvando…';
      const {error}=await getSB().rpc('radar_cp_depara_definir',{p_desc_norm:x.desc_norm,p_conta:conta});
      if(error){bt.disabled=false;bt.textContent='Salvar';alert('Não salvou: '+error.message);return;}
      x.conta_codigo=conta; x.origem='manual'; x.situacao=3; bt.textContent='Salvo';
    });
    b.querySelector('#cp-context').innerHTML=`<div class="cp-notice">Cada descrição das planilhas de 2026 é ligada a uma conta do plano de contas. A ligação vale para todas as empresas e para os meses seguintes: decidiu uma vez, fica valendo. "Regra automática" foi sugerida pelo Radar a partir de palavras da descrição; "Sistema antigo" vem das importações até abril e tem erros conhecidos, por isso aparece para revisar. Ao salvar, a sua escolha passa na frente de qualquer regra.</div>`;
  }

  const DRE_EST=[
    {k:'REC',t:'Receita recebida (IXC)',tipo:'rec'},
    {k:'DESP_TRIB',t:'(-) Impostos (Simples e tributos)',tipo:'desp'},
    {k:'=RL',t:'Receita líquida',tipo:'tot',f:['REC','-DESP_TRIB']},
    {k:'CSP',t:'(-) Custos dos serviços (link, sistemas, energia, materiais)',tipo:'desp'},
    {k:'=LB',t:'Lucro bruto',tipo:'tot',f:['=RL','-CSP']},
    {k:'DESP_PESSOAL',t:'(-) Pessoal',tipo:'desp'},
    {k:'DESP_ADM',t:'(-) Administrativas e frota',tipo:'desp'},
    {k:'DESP_VENDAS',t:'(-) Comerciais',tipo:'desp'},
    {k:'=RO',t:'Resultado operacional',tipo:'tot',f:['=LB','-DESP_PESSOAL','-DESP_ADM','-DESP_VENDAS']},
    {k:'DESP_FINANC',t:'(-) Financeiras e tarifas',tipo:'desp'},
    {k:'OUTRAS_DESP',t:'(-) Outras (acordos, diversas)',tipo:'desp'},
    {k:'A_CLASSIFICAR',t:'(-) Ainda sem conta no de/para',tipo:'desp'},
    {k:'=RP',t:'Resultado do período',tipo:'tot',f:['=RO','-DESP_FINANC','-OUTRAS_DESP','-A_CLASSIFICAR']}];
  async function loadDre(own){
    const b=box();if(!b)return;
    b.querySelector('#cp-form').style.display='none';
    b.querySelectorAll('[data-view]').forEach(el=>el.setAttribute('aria-selected',String(el.dataset.view===state.view)));
    b.querySelector('#cp-result').innerHTML=msg('Montando a DRE…');b.querySelector('#cp-context').replaceChildren();b.querySelector('#cp-coverage').replaceChildren();
    const {data,error}=await getSB().rpc('radar_cp_dre',{p_ano:null,p_empresa:state.dreEmp||null});
    if(own!==generation||!box())return;
    if(error){b.querySelector('#cp-result').innerHTML=msg('DRE indisponível: '+error.message);return;}
    paintDre(data);
  }
  function paintDre(d){
    const b=box();if(!b)return;
    const meses=(d.meses||[]).sort(), L=d.linhas||[], R=d.receita||{};
    const v={}; const put=(k,m,x)=>{(v[k] ||= {})[m]=(v[k][m]||0)+Number(x||0);};
    meses.forEach(m=>put('REC',m,R[m]||0));
    L.forEach(x=>put(x.linha,x.mes,x.valor));
    DRE_EST.filter(e=>e.f).forEach(e=>meses.forEach(m=>{let t=0;e.f.forEach(t2=>{const neg=t2.startsWith('-'),k=t2.replace('-','');t+=(neg?-1:1)*((v[k]||{})[m]||0);});put(e.k,m,t);}));
    const tot=k=>meses.reduce((t,m)=>t+((v[k]||{})[m]||0),0);
    const parcial=m=>d.receita_ate&&String(d.receita_ate).slice(0,7)<=m;
    const emp=['','RECIFE','JABOATAO','ITAPISSUMA','IG','MADALENA'];
    const det=k=>{const g={};L.filter(x=>x.linha===k).forEach(x=>{const c=(x.conta_codigo||'')+' '+(x.conta||'Sem conta');(g[c] ||= {})[x.mes]=(g[c][x.mes]||0)+Number(x.valor||0);});return Object.entries(g).sort((a,b2)=>Object.values(b2[1]).reduce((s,n)=>s+n,0)-Object.values(a[1]).reduce((s,n)=>s+n,0));};
    let h=`<div class="cp-mes-top"><label class="cp-mes-sel">Empresa <select id="cp-dre-emp">${emp.map(e=>`<option value="${e}"${(state.dreEmp||'')===e?' selected':''}>${e||'Consolidado'}</option>`).join('')}</select></label></div>
    <div class="cp-table"><table class="cp-dre"><thead><tr><th>${d.ano}</th>${meses.map(m=>`<th class="cp-number">${mesTxt(m+'-01')}${parcial(m)?'<br><small>parcial</small>':''}</th>`).join('')}<th class="cp-number">Total</th></tr></thead><tbody>`;
    DRE_EST.forEach(e=>{
      const cls=e.tipo==='tot'?'cp-total':e.tipo==='rec'?'cp-rec':'';
      const exp=e.tipo==='desp'&&det(e.k).length;
      h+=`<tr class="${cls}${exp?' cp-dre-exp':''}" ${exp?`data-dre="${e.k}"`:''}><td>${exp?'<span class="cp-mais">+</span> ':''}${esc(e.t)}</td>${meses.map(m=>`<td class="cp-number${(v[e.k]||{})[m]<0?' cp-dif':''}">${m0((v[e.k]||{})[m]||0)}</td>`).join('')}<td class="cp-number">${m0(tot(e.k))}</td></tr>`;
      if(exp) det(e.k).forEach(([c,mm])=>{h+=`<tr class="cp-dre-det" data-pai="${e.k}" hidden><td><small>${esc(c)}</small></td>${meses.map(m=>`<td class="cp-number"><small>${mm[m]?m0(mm[m]):''}</small></td>`).join('')}<td class="cp-number"><small>${m0(Object.values(mm).reduce((s,n)=>s+n,0))}</small></td></tr>`;});
      if(e.k==='=RP') h+=`<tr><td><small>Margem sobre a receita</small></td>${meses.map(m=>{const r=(v.REC||{})[m]||0;return `<td class="cp-number"><small>${r?Math.round(((v['=RP']||{})[m]||0)/r*100)+'%':'-'}</small></td>`;}).join('')}<td class="cp-number"><small>${tot('REC')?Math.round(tot('=RP')/tot('REC')*100)+'%':'-'}</small></td></tr>`;
    });
    h+=`</tbody></table></div>`;
    const fora=[['FORA_ATIVO','Investimentos, compras de empresas, equipamentos e aplicações'],['FORA_PASSIVO','Parcelas de empréstimos e financiamentos, faturas de cartão e acordos com sócios']];
    h+=`<h3 class="cp-h">Saídas de caixa que não são despesa</h3><div class="cp-table"><table><thead><tr><th></th>${meses.map(m=>`<th class="cp-number">${mesTxt(m+'-01')}</th>`).join('')}<th class="cp-number">Total</th></tr></thead><tbody>${fora.map(([k,t])=>`<tr class="cp-dre-exp" data-dre="${k}"><td><span class="cp-mais">+</span> ${t}</td>${meses.map(m=>`<td class="cp-number">${m0((v[k]||{})[m]||0)}</td>`).join('')}<td class="cp-number">${m0(tot(k))}</td></tr>${det(k).map(([c,mm])=>`<tr class="cp-dre-det" data-pai="${k}" hidden><td><small>${esc(c)}</small></td>${meses.map(m=>`<td class="cp-number"><small>${mm[m]?m0(mm[m]):''}</small></td>`).join('')}<td class="cp-number"><small>${m0(Object.values(mm).reduce((s,n)=>s+n,0))}</small></td></tr>`).join('')}`).join('')}</tbody></table></div>`;
    b.querySelector('#cp-result').innerHTML=h;
    b.querySelector('#cp-dre-emp').onchange=e=>{state.dreEmp=e.target.value;load();};
    b.querySelectorAll('[data-dre]').forEach(tr=>tr.onclick=()=>{const k=tr.dataset.dre, rows=b.querySelectorAll(`[data-pai="${k}"]`), abrir=rows[0]?.hidden;rows.forEach(r=>r.hidden=!abrir);const s=tr.querySelector('.cp-mais');if(s)s.textContent=abrir?'-':'+';});
    b.querySelector('#cp-context').innerHTML=`<div class="cp-notice">DRE gerencial. Receita: valor recebido no IXC em cada mês (inclui juros e multas, ainda sem separar), leitura até ${date(d.receita_ate)}; NandoNet e Pablom contam a partir de setembro e entram na Madalena. Despesas: saídas das planilhas pelo mês da aba (valor previsto), classificadas pelo de/para. Não tem depreciação nem o detalhe das compras no cartão. Camaragibe fica fora. Clique numa linha com + para ver as contas.</div>`;
  }
  async function loadAgenda(own){
    const b=box();if(!b)return;
    b.querySelector('#cp-form').style.display='none';
    b.querySelectorAll('[data-view]').forEach(el=>el.setAttribute('aria-selected',String(el.dataset.view===state.view)));
    b.querySelector('#cp-result').innerHTML=msg('Lendo a agenda das planilhas…');b.querySelector('#cp-context').replaceChildren();b.querySelector('#cp-coverage').replaceChildren();
    const {data,error}=await getSB().rpc('radar_cp_planilhas',{});
    if(own!==generation||!box())return;
    if(error){b.querySelector('#cp-result').innerHTML=msg('Agenda indisponível: '+error.message);return;}
    paintAgenda(data);
  }
  function paintAgenda(d){
    const b=box();if(!b)return;
    const hoje=d.hoje, mais7=local(new Date(new Date(hoje+'T12:00:00').getTime()+7*864e5));
    const itens=(d.agenda||[]).filter(i=>!state.filialAg||i.filial===state.filialAg);
    const grupo=i=>i.data_vencimento<hoje?0:i.data_vencimento===hoje?1:i.data_vencimento<=mais7?2:3;
    const g=[[],[],[],[]];itens.forEach(i=>g[grupo(i)].push(i));
    const soma=a=>a.reduce((t,i)=>t+Number(i.previsto||0),0);
    const filiais=[...new Set((d.leituras||[]).map(l=>l.filial))];
    const dias=v=>Math.round((new Date(hoje+'T12:00:00')-new Date(v+'T12:00:00'))/864e5);
    const prazo=i=>{const n=dias(i.data_vencimento);return n>0?`Venceu há ${n} dia${n>1?'s':''}`:n===0?'Vence hoje':n===-1?'Vence amanhã':`Vence em ${-n} dias`;};
    let html=`<div class="cp-stats">${ATRASO.map((t,k)=>`<div class="cp-stat${k===0&&g[0].length?' cp-alerta':''}"><span>${t}</span><strong>${g[k].length} · ${money(soma(g[k]))}</strong></div>`).join('')}</div>
      <div class="cp-chips"><button type="button" data-fil="" aria-pressed="${!state.filialAg}">Todas</button>${filiais.map(f=>`<button type="button" data-fil="${esc(f)}" aria-pressed="${state.filialAg===f}">${esc(f)}</button>`).join('')}</div>`;
    g.forEach((lista,k)=>{
      if(!lista.length)return;
      html+=`<details class="cp-grupo"${k<3?' open':''}><summary>${ATRASO[k]} <span>${lista.length} · ${money(soma(lista))}</span></summary><div class="cp-table"><table><thead><tr><th>Vencimento</th><th>Empresa</th><th>Despesa</th><th>Grupo</th><th class="cp-number">Previsto</th><th>Observação</th></tr></thead><tbody>${lista.map(i=>`<tr><td>${date(i.data_vencimento)}<br><small>${prazo(i)}</small></td><td>${esc(i.filial)}</td><td>${esc(i.descricao)}</td><td>${esc(i.secao||'')}</td><td class="cp-number">${money(i.previsto)}</td><td>${outraFilial(i.info)?'<b>Conferir: </b>':''}${esc(i.info||'')}</td></tr>`).join('')}</tbody></table></div></details>`;
    });
    if(!itens.length)html+=msg('Nenhum pagamento em aberto neste recorte, ou as planilhas ainda não foram lidas.');
    b.querySelector('#cp-result').innerHTML=html;
    b.querySelectorAll('[data-fil]').forEach(x=>x.onclick=()=>{state.filialAg=x.dataset.fil;paintAgenda(d);});
    b.querySelector('#cp-context').innerHTML=`<div class="cp-notice">Fonte: planilhas de fluxo de caixa de cada filial, lidas a cada edição e conferidas todo dia às 6h. A tela se atualiza sozinha. Entra aqui o que tem valor previsto e está com a coluna REALIZADO vazia, do mês anterior até os próximos 30 dias. Linhas marcadas com "Conferir" dizem que foram pagas por outra filial ou agendadas: confirme e preencha o REALIZADO na planilha.</div>`;
    const lt=(d.leituras||[]).map(l=>{const u=l.ultima||{};return {filial:l.filial,lida:l.ultima_ok?new Date(l.ultima_ok).toLocaleString('pt-BR'):'Ainda não lida',alterada:u.modificado_em?new Date(u.modificado_em).toLocaleString('pt-BR'):'',situacao:!l.ativo?'Desativada':!u.em?'Aguardando primeira leitura':u.ok?'OK':'Erro: '+(u.erro||'')};});
    b.querySelector('#cp-coverage').innerHTML=`<details><summary>Leitura das planilhas</summary><div class="cp-table"><table><thead><tr><th>Filial</th><th>Última leitura</th><th>Planilha alterada em</th><th>Situação</th></tr></thead><tbody>${lt.map(r=>`<tr><td>${esc(r.filial)}</td><td>${esc(r.lida)}</td><td>${esc(r.alterada)}</td><td>${esc(r.situacao)}</td></tr>`).join('')}</tbody></table></div></details>`;
  }
  async function load(){
    const b=box();if(!b)return;
    if(!authorized||document.body.dataset.activeMod!=='cp')return;
    const own=++generation;controller?.abort();controller=new AbortController();
    if(state.view==='pagamentos')return loadAgenda(own);
    if(state.view==='mes')return loadMes(own);
    if(state.view==='caixa30')return loadCaixa(own);
    if(state.view==='depara')return loadDepara(own);
    if(state.view==='dre26')return loadDre(own);
    b.querySelector('#cp-form').style.display='';
    const active=['resumo','lancamentos','dre'].includes(state.view);
    b.querySelector('#cp-regime').disabled=!active;b.querySelector('#cp-status').disabled=!active;
    b.querySelectorAll('[data-view]').forEach(el=>el.setAttribute('aria-selected',String(el.dataset.view===state.view)));
    b.querySelector('#cp-result').innerHTML=msg('Consultando a fonte financeira…');b.querySelector('#cp-context').replaceChildren();b.querySelector('#cp-coverage').replaceChildren();last=null;
    const thisController=controller;
    const timer=setTimeout(()=>thisController.abort(),30000);
    try{
      const {data,error}=await getSB().auth.getSession();
      if(error||!data?.session?.access_token)throw new Error('Entre novamente no Radar.');
      const body={...state,status:active?state.status:'todos',regime:active?state.regime:'competencia'};
      const r=await fetch(SUPABASE_URL+'/functions/v1/contas-pagar-consulta',{method:'POST',headers:{Authorization:'Bearer '+data.session.access_token,apikey:SUPABASE_ANON,'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal,cache:'no-store'});
      const result=await r.json().catch(()=>({erro:'Resposta indisponível. Nenhum valor foi atualizado.'}));
      if(own!==generation)return;
      if(!r.ok||!result.ok)throw new Error(result.erro||'Consulta indisponível.');
      display(result);
    }catch(e){if(own===generation&&box())b.querySelector('#cp-result').innerHTML=msg(e.name==='AbortError'?'A consulta excedeu o tempo de espera. Tente novamente.':e.message);}
    finally{clearTimeout(timer);}
  }
  window.cpTab=v=>{state.view=v;state.pagina=1;if(document.body.dataset.activeMod==='cp'&&box()?.querySelector('#cp-result')){shell();if(authorized)load();cpMarcar();}else{go('cp');}};
  function cpMarcar(){document.querySelectorAll('#cp-nav .nav-sub').forEach(n=>n.classList.toggle('active',n.dataset.cp===(NOVAS[state.view]?state.view:'antigo')));}
  window.cpMarcar=cpMarcar;
  window.cpSubAtual=()=>NOVAS[state.view]?state.view:'antigo';
  window.cpClear=clear;
  window.cpSyncVisibility=visibility;
  window.renderContasPagar=async()=>{
    shell();cpMarcar();box().querySelector('#cp-result').innerHTML=msg('Conferindo seu acesso…');
    await visibility();if(authorized){if(!box().querySelector('#cp-result'))shell();load();}
  };
  const sb=getSB();
  if(sb){sb.auth.onAuthStateChange((event,session)=>{if(identity!==session?.user?.id||event==='SIGNED_OUT'){clear();authorized=false;identity=session?.user?.id||null;const nav=document.getElementById('cp-nav');if(nav)nav.hidden=true;}setTimeout(visibility,0);});}
  visibility();
  // Leitura ao vivo: quando uma planilha é editada, a aba chega ao Radar em segundos; a tela aberta se atualiza sozinha.
  let ultimaVista=null;
  setInterval(async()=>{
    try{
      if(!authorized||document.hidden||document.body.dataset.activeMod!=='cp'||!NOVAS[state.view]||state.view==='depara')return;
      const {data,error}=await getSB().rpc('radar_cp_ultima_leitura',{});
      if(error||!data?.em)return;
      if(ultimaVista&&data.em!==ultimaVista){load();window.toast?.('Planilha alterada: tela atualizada às '+new Date(data.em).toLocaleTimeString('pt-BR'));}
      ultimaVista=data.em;
    }catch(e){/* tenta de novo no próximo ciclo */}
  },20000);
})();
