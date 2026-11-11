(() => {
  const talitha = '7d1a7dfb-687a-4e7a-8cbb-f1f6342ce34f';
  const clarice = '7f7bccf3-db53-47df-8946-578f57016381';
  const statuses = {pendente:'Pendente', andamento:'Em andamento', bloqueada:'Bloqueada', concluida:'Concluída'};
  const box = () => document.getElementById('mod-agendaTalitha');
  const uid = () => getRadarUser()?.id;
  const allowed = () => Boolean(uid());
  window.agendaPodeAcessar = allowed;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);
  const date = value => String(value).slice(0,10).split('-').reverse().join('/');
  let opened = null, archive = false, scope = 'talitha', tasks = [], busy = false, generation = 0;

  window.agendaInicio = () => {
    const nav = document.querySelector('[data-mod="agendaTalitha"]');
    if(nav) nav.hidden = !allowed();
    if(!allowed()) { opened = null; return false; }
    if(uid() !== talitha || opened === uid()) return false;
    opened = uid();
    go('agendaTalitha');
    return true;
  };


  // Aviso ao abrir o Radar: atividades atrasadas e do dia, uma vez por sessão.
  window.agendaAviso = async () => {
    if(!allowed()) return;
    const quem = uid();
    let r;
    try { r = await getSB().rpc('radar_agenda_talitha', {p_acao:'listar', p_dados:{}}); } catch(e) { return; }
    if(r.error || quem !== uid()) return;
    const zone = {timeZone:'America/Sao_Paulo'};
    const hoje = new Date().toLocaleDateString('sv-SE', zone);
    const abertas = (r.data?.tarefas || []).filter(t => !t.arquivada_em && t.status !== 'concluida' && t.prazo);
    const atrasadas = abertas.filter(t => t.prazo < hoje);
    const doDia = abertas.filter(t => t.prazo === hoje);
    const nav = document.querySelector('[data-mod="agendaTalitha"] span');
    if(nav) nav.innerHTML = 'Agenda' + (atrasadas.length + doDia.length ? ` <b class="ag-badge">${atrasadas.length + doDia.length}</b>` : '');
    if(!atrasadas.length && !doDia.length) return;
    let chave = 'agendaAviso:' + quem + ':' + hoje;
    try { if(sessionStorage.getItem(chave)) return; sessionStorage.setItem(chave, '1'); } catch(e) {}
    document.getElementById('ag-aviso')?.remove();
    const nome = t => esc(t.titulo) + (uid() === clarice && t.agenda === 'talitha' ? ' <small>(Talitha)</small>' : '');
    const lista = [...atrasadas.map(t => `<li><b>Atrasada</b> desde ${esc(date(t.prazo))}: ${nome(t)}</li>`), ...doDia.map(t => `<li><b>Hoje</b>${t.hora ? ' às ' + esc(t.hora.slice(0,5)) : ''}: ${nome(t)}</li>`)];
    const div = document.createElement('div');
    div.id = 'ag-aviso';
    div.setAttribute('role', 'alert');
    div.innerHTML = `<h4>Agenda: ${atrasadas.length} atrasada(s) e ${doDia.length} para hoje</h4><ul>${lista.slice(0,6).join('')}</ul>${lista.length > 6 ? `<p>e mais ${lista.length - 6}.</p>` : ''}
      <div class="ag-aviso-acoes"><button type="button" class="btn sm primary" data-abrir>Abrir agenda</button><button type="button" class="btn sm" data-fechar>Fechar</button></div>`;
    div.querySelector('[data-abrir]').onclick = () => { div.remove(); go('agendaTalitha'); };
    div.querySelector('[data-fechar]').onclick = () => div.remove();
    document.body.append(div);
  };
  window.agendaLimpar = () => {
    generation++;
    tasks = [];
    archive = false;
    scope = 'talitha';
    busy = false;
    if(box()) box().replaceChildren();
    document.getElementById('ag-aviso')?.remove();
  };

  async function request(action, data = {}) {
    const session = uid(), version = generation;
    const result = await getSB().rpc('radar_agenda_talitha', {p_acao:action, p_dados:data});
    if(session !== uid() || version !== generation) return false;
    if(result.error) throw result.error;
    tasks = result.data?.tarefas || [];
    return true;
  }

  window.renderAgendaTalitha = async () => {
    if(!allowed()) return;
    const version = ++generation;
    busy = false;
    box().textContent = 'Carregando agenda…';
    try { if(await request('listar')) paint(); }
    catch(error) {
      if(version !== generation) return;
      box().textContent = error.message || 'Não foi possível carregar a agenda.';
      const retry = document.createElement('button');
      retry.className = 'btn sm';
      retry.textContent = 'Tentar novamente';
      retry.onclick = window.renderAgendaTalitha;
      box().append(' ', retry);
    }
  };

  function paint() {
    if(!allowed()) return;
    const zone = {timeZone:'America/Sao_Paulo'}, now = new Date();
    const today = now.toLocaleDateString('sv-SE', zone);
    const time = now.toLocaleTimeString('pt-BR',{...zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
    const dias = p => Math.round((new Date(p+'T12:00:00') - new Date(today+'T12:00:00')) / 86400000);
    const late = t => t.prazo && (t.prazo < today || (t.prazo === today && t.hora && t.hora.slice(0,5) < time));
    const rows = tasks.filter(t => Boolean(t.arquivada_em) === archive && (uid() !== clarice || t.agenda === scope));
    const urg = t => {
      if(t.status === 'concluida') return 'ok';
      if(!t.prazo) return 'sem';
      const d = dias(t.prazo);
      if(d < 0 || late(t)) return 'atrasada';
      if(d === 0) return 'hoje';
      return d <= 7 ? 'semana' : 'depois';
    };
    const prazoTxt = t => {
      if(!t.prazo) return 'Sem prazo';
      const d = dias(t.prazo), h = t.hora ? ' às ' + t.hora.slice(0,5) : '';
      if(t.status === 'concluida') return 'Prazo ' + date(t.prazo);
      if(d < 0) return `Atrasada há ${-d} dia${d === -1 ? '' : 's'} (${date(t.prazo)})`;
      if(d === 0) return (late(t) ? 'Venceu hoje' : 'Vence hoje') + h;
      if(d === 1) return 'Vence amanhã' + h;
      return `Vence em ${d} dias (${date(t.prazo)}${h})`;
    };
    const grupos = [
      ['atrasada','Atrasadas','Prazo vencido e ainda não concluídas'],
      ['hoje','Para hoje',''],
      ['semana','Próximos 7 dias',''],
      ['depois','Mais adiante',''],
      ['sem','Sem prazo','Rotinas contínuas'],
    ];
    const abertas = rows.filter(t => t.status !== 'concluida');
    const conta = k => abertas.filter(t => urg(t) === k).length;
    const card = t => {
      const u = urg(t), ult = (t.historico || [])[0];
      return `<article class="ag-card" data-urg="${u}">
        <div class="ag-card-top"><span class="ag-prazo">${esc(prazoTxt(t))}</span><span class="ag-status" data-status="${esc(t.status)}">${esc(statuses[t.status])}</span></div>
        <h3>${esc(t.titulo)}</h3>
        <p class="ag-meta">Atribuída por ${esc(t.autor)}${t.semanal ? ' · Repete toda segunda-feira' : ''}</p>
        ${t.detalhes ? `<p class="ag-note">${esc(t.detalhes)}</p>` : ''}
        ${ult ? `<div class="ag-ultima"><b>Última atualização</b> · ${esc(ult.autor)}, ${esc(new Date(ult.em).toLocaleString('pt-BR',{...zone,day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}))}<br>${esc(ult.justificativa)}</div>` : '<div class="ag-ultima ag-vazio">Nenhuma atualização registrada ainda.</div>'}
        <details><summary>${archive ? 'Ver histórico' : 'Atualizar status e ver histórico'} (${(t.historico || []).length})</summary>
        ${archive ? '' : `<form class="ag-form" data-action="atualizar" data-id="${esc(t.id)}">
          <label>Novo status<select name="status">${Object.entries(statuses).map(([k,v]) => `<option value="${k}" ${k===t.status?'selected':''}>${v}</option>`).join('')}</select></label>
          <label class="ag-wide">O que foi feito ou o que está impedindo<textarea name="justificativa" rows="2" required maxlength="2000"></textarea></label>
          <div class="ag-wide"><button class="btn sm primary">Salvar atualização</button></div>
        </form>`}
        ${(t.historico || []).map(h => `<div class="ag-history"><small>${esc(new Date(h.em).toLocaleString('pt-BR',{...zone,day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}))} · ${esc(h.autor)} · <b>${esc(statuses[h.status])}</b></small><p class="ag-note">${esc(h.justificativa)}</p></div>`).join('')}
        </details>
        ${t.pode_arquivar ? `<div class="ag-card-acoes"><button type="button" class="ag-link" data-archive="${esc(t.id)}">Arquivar</button></div>` : ''}
      </article>`;
    };
    const resumo = archive ? '' : `<div class="ag-resumo">
      <div class="ag-kpi" data-urg="atrasada"><b>${conta('atrasada')}</b><span>Atrasadas</span></div>
      <div class="ag-kpi" data-urg="hoje"><b>${conta('hoje')}</b><span>Para hoje</span></div>
      <div class="ag-kpi" data-urg="semana"><b>${conta('semana')}</b><span>Próximos 7 dias</span></div>
      <div class="ag-kpi"><b>${abertas.filter(t => t.status === 'andamento').length}</b><span>Em andamento</span></div>
      <div class="ag-kpi" data-urg="bloq"><b>${abertas.filter(t => t.status === 'bloqueada').length}</b><span>Bloqueadas</span></div>
    </div>`;
    const lista = archive
      ? `<div class="ag-grid">${rows.map(card).join('') || '<p class="ag-vazio">Nenhuma atividade arquivada.</p>'}</div>`
      : grupos.map(([k, titulo, sub]) => {
          const g = abertas.filter(t => urg(t) === k);
          return g.length ? `<section class="ag-grupo" data-urg="${k}"><h2>${titulo} <span>${g.length}</span>${sub ? `<small>${sub}</small>` : ''}</h2><div class="ag-grid">${g.map(card).join('')}</div></section>` : '';
        }).join('') + (() => {
          const c = rows.filter(t => t.status === 'concluida');
          return c.length ? `<details class="ag-grupo ag-concluidas"><summary>Concluídas, aguardando arquivamento <span>${c.length}</span></summary><div class="ag-grid">${c.map(card).join('')}</div></details>` : '';
        })() || '<p class="ag-vazio">Nenhuma atividade nesta agenda. Use "Nova atividade" para começar.</p>';
    box().innerHTML = `<div class="ag-topo">
      <div><h1 class="ag-titulo">${uid() === clarice ? (scope === 'talitha' ? 'Agenda da Talitha' : 'Minha agenda') : 'Minha agenda'}</h1>
      <p class="ag-sub">${archive ? 'Atividades arquivadas, com o histórico guardado.' : 'Prazos, status e o que foi feito em cada atividade.'}</p></div>
      <button type="button" class="btn sm primary" data-new>Nova atividade</button></div>
      ${uid() === clarice ? `<div class="ag-tabs ag-bar">
      <button type="button" class="btn sm" data-scope="talitha" aria-pressed="${scope==='talitha'}">Agenda da Talitha</button>
      <button type="button" class="btn sm" data-scope="pessoal" aria-pressed="${scope==='pessoal'}">Minha agenda</button>
      </div>` : ''}
      <form class="ag-form ag-nova" data-action="criar" hidden>
        <label class="ag-wide">Título<input name="titulo" required maxlength="160" placeholder="O que precisa ser feito"></label>
        <label>Prazo<input type="date" name="prazo" required></label>
        <label>Horário (opcional)<input type="time" name="hora"></label>
        <label class="ag-wide">Detalhes<textarea name="detalhes" rows="2" maxlength="3000" placeholder="Contexto, critério de pronto, contatos"></textarea></label>
        <div class="ag-wide"><button class="btn sm primary">Adicionar à agenda</button></div>
      </form>
      <p class="ag-error" role="alert" hidden></p>
      ${resumo}
      <div class="ag-tabs ag-bar" aria-label="Visualização">
        <button type="button" class="btn sm" data-view="ativas" aria-pressed="${!archive}">Na agenda</button>
        <button type="button" class="btn sm" data-view="arquivadas" aria-pressed="${archive}">Arquivadas</button>
      </div>
      <div class="ag-list">${lista}</div>`;
  }

  async function save(action, data, trigger) {
    if(busy || !allowed()) return;
    const version = generation;
    busy = true;
    if(trigger) trigger.disabled = true;
    const errorBox = box().querySelector('.ag-error');
    errorBox.hidden = true;
    try {
      if(await request(action, data)) {
        if(action === 'criar') archive = false;
        paint();
      }
    } catch(error) {
      if(version === generation) {
        errorBox.textContent = error.message || 'Não foi possível salvar.';
        errorBox.hidden = false;
      }
    } finally {
      if(version === generation) busy = false;
      if(trigger) trigger.disabled = false;
    }
  }

  box()?.addEventListener('submit', e => {
    e.preventDefault();
    const form = e.target;
    const data = Object.fromEntries(new FormData(form));
    if(form.dataset.action === 'criar' && uid() === clarice) data.agenda = scope;
    if(form.dataset.id) data.id = form.dataset.id;
    save(form.dataset.action, data, e.submitter);
  });
  box()?.addEventListener('click', e => {
    const button = e.target.closest('button');
    if(!button || busy) return;
    if(button.dataset.scope) { scope = button.dataset.scope; archive = false; paint(); }
    if(button.dataset.view) { archive = button.dataset.view === 'arquivadas'; paint(); }
    if(button.hasAttribute('data-new')) {
      const form = box().querySelector('[data-action="criar"]');
      form.hidden = !form.hidden;
      if(!form.hidden) form.querySelector('input').focus();
    }
    if(button.dataset.archive && confirm('Arquivar esta atividade? O histórico será mantido.')) {
      save('arquivar',{id:button.dataset.archive},button);
    }
  });
  window.agendaInicio();
})();
