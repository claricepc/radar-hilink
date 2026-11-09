/* Read-only financial consultation. No browser financial cache or mutation API. */
(()=>{
  'use strict';
  const tabs={resumo:'Resumo',lancamentos:'Lançamentos',agenda:'Agenda',dre:'DRE',razao:'Razão',caixa:'Caixa',conciliacao:'Conciliação',auditoria:'Auditoria'};
  const now=new Date(),pad=n=>String(n).padStart(2,'0');
  const local=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const state={view:'resumo',de:local(new Date(now.getFullYear(),now.getMonth(),1)),ate:local(now),empresa:null,pagina:1,status:'todos',regime:'competencia'};
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
    b.innerHTML=`<div class="cp-head"><div><h2>Contas a pagar</h2><p>Consulta ao financeiro existente</p></div><span class="cp-mode">Somente leitura</span></div>
      <form class="cp-filters" id="cp-form"><label>De<input id="cp-de" type="date" min="2026-01-01" value="${state.de}" required></label>
      <label>Até<input id="cp-ate" type="date" min="2026-01-01" value="${state.ate}" required></label>
      <label>Empresa<select id="cp-empresa"><option value="">Todas autorizadas</option></select></label>
      <label id="cp-regime-label">Período por<select id="cp-regime"><option value="competencia">Competência</option><option value="caixa">Pagamento</option></select></label>
      <label id="cp-status-label">Situação<select id="cp-status"><option value="todos">Todas</option><option value="PAGO">Pago</option><option value="PROVISIONADO">Provisionado</option></select></label>
      <button type="submit">Consultar</button></form>
      <div class="cp-tabs" role="tablist" aria-label="Consulta financeira">${Object.entries(tabs).map(([id,label])=>`<button type="button" role="tab" data-view="${id}" aria-selected="${id===state.view}">${label}</button>`).join('')}</div>
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
    return `<div class="cp-table"><table><thead><tr>${keys.map(k=>`<th scope="col">${labels[k]}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${keys.map(k=>`<td class="${amounts.has(k)?'cp-number':''}">${esc(amounts.has(k)?money(row[k]):k.startsWith('data_')?date(row[k]):row[k]??'Não informado')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
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
    b.querySelector('#cp-context').innerHTML=`<p>Fonte: ${esc(data.fonte)} · Consulta: ${esc(new Date(data.consultado_em).toLocaleString('pt-BR'))} · ${date(state.de)} a ${date(state.ate)} · ${state.view==='agenda'?'Vencimento':['razao','caixa','conciliacao','auditoria'].includes(state.view)?'Data própria da aba':state.regime==='caixa'?'Pagamento':'Competência'}</p>${notes[state.view]?`<div class="cp-notice">${notes[state.view]}</div>`:''}`;
    const coverage=(data.empresas||[]).filter(e=>!state.empresa||e.id===state.empresa);
    const coverageRows=coverage.map(e=>({filial:e.codigo,data_transacao:e.extrato_ate,alerta:!e.extrato_ate?'Sem extrato desde 2026':String(e.extrato_ate).slice(0,10)<state.ate?'Extrato não cobre todo o período solicitado':'Conferir abrangência dos arquivos de origem'}));
    b.querySelector('#cp-coverage').innerHTML=`<details><summary>Cobertura da fonte por empresa</summary><p>Última competência pode incluir previsão futura. Ela não comprova atualização bancária.</p>${table(coverageRows)}</details>`;
    if(coverage.some(e=>!e.extrato_ate||String(e.extrato_ate).slice(0,10)<state.ate))b.querySelector('#cp-context').insertAdjacentHTML('beforeend','<div class="cp-notice">Cobertura bancária incompleta neste período. Não use esta consulta como fechamento definitivo.</div>');
  }
  async function load(){
    const b=box();if(!b)return;
    if(!authorized||document.body.dataset.activeMod!=='cp')return;
    const own=++generation;controller?.abort();controller=new AbortController();
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
  window.cpClear=clear;
  window.cpSyncVisibility=visibility;
  window.renderContasPagar=async()=>{
    shell();box().querySelector('#cp-result').innerHTML=msg('Conferindo seu acesso…');
    await visibility();if(authorized){if(!box().querySelector('#cp-result'))shell();load();}
  };
  const sb=getSB();
  if(sb){sb.auth.onAuthStateChange((event,session)=>{if(identity!==session?.user?.id||event==='SIGNED_OUT'){clear();authorized=false;identity=session?.user?.id||null;const nav=document.getElementById('cp-nav');if(nav)nav.hidden=true;}setTimeout(visibility,0);});}
  visibility();
})();
