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
    const now = new Date(), zone = {timeZone:'America/Sao_Paulo'};
    const today = now.toLocaleDateString('sv-SE', zone);
    const time = now.toLocaleTimeString('pt-BR',{...zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
    const late = t => t.prazo && (t.prazo < today || (t.prazo === today && t.hora && t.hora.slice(0,5) < time));
    const rows = tasks.filter(t => Boolean(t.arquivada_em) === archive && (uid() !== clarice || t.agenda === scope));
    box().innerHTML = `${uid() === clarice ? `<div class="ag-tabs ag-bar">
      <button type="button" class="btn sm" data-scope="talitha" aria-pressed="${scope==='talitha'}">Agenda da Talitha</button>
      <button type="button" class="btn sm" data-scope="pessoal" aria-pressed="${scope==='pessoal'}">Minha agenda</button>
      </div>` : ''}<div class="ag-bar"><div class="ag-tabs" aria-label="Visualização">
      <button type="button" class="btn sm" data-view="ativas" aria-pressed="${!archive}">Na agenda</button>
      <button type="button" class="btn sm" data-view="arquivadas" aria-pressed="${archive}">Arquivadas</button>
      </div><button type="button" class="btn sm primary" data-new>Nova atividade</button></div>
      <form class="ag-form" data-action="criar" hidden>
        <label>Título<input name="titulo" required maxlength="160"></label>
        <label>Prazo<input type="date" name="prazo" required></label>
        <label>Horário (opcional)<input type="time" name="hora"></label>
        <label class="ag-wide">Detalhes<textarea name="detalhes" rows="2" maxlength="3000"></textarea></label>
        <div class="ag-wide"><button class="btn sm primary">Adicionar à agenda</button></div>
      </form>
      <p class="ag-error" role="alert" hidden></p>
      <div class="ag-list">${rows.map(t => `<article class="ag-item">
        <div class="ag-item-head"><div><h3>${esc(t.titulo)}</h3><small>${esc(t.autor)} · ${t.prazo ? 'Prazo: '+esc(date(t.prazo))+(t.hora?' às '+esc(t.hora.slice(0,5)):'') : 'Rotina contínua'}${t.semanal?' · Toda segunda-feira':''}${late(t) && t.status !== 'concluida' && !archive ? ' · Em atraso' : ''}</small></div>
        <span class="ag-status" data-status="${esc(t.status)}">${esc(statuses[t.status])}</span></div>
        ${t.detalhes ? `<p class="ag-note">${esc(t.detalhes)}</p>` : ''}
        <details><summary>${archive ? 'Histórico' : 'Atualizar e ver histórico'}</summary>
        ${archive ? '' : `<form class="ag-form" data-action="atualizar" data-id="${esc(t.id)}">
          <label>Status<select name="status">${Object.entries(statuses).map(([k,v]) => `<option value="${k}" ${k===t.status?'selected':''}>${v}</option>`).join('')}</select></label>
          <label>Justificativa<textarea name="justificativa" rows="2" required maxlength="2000"></textarea></label>
          <div class="ag-wide"><button class="btn sm primary">Salvar atualização</button></div>
        </form>`}
        ${(t.historico || []).map(h => `<div class="ag-history"><small>${esc(h.autor)} · ${esc(new Date(h.em).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}))} · ${esc(statuses[h.status])}</small><p class="ag-note">${esc(h.justificativa)}</p></div>`).join('') || '<p>Sem atualizações.</p>'}
        </details>
        ${t.pode_arquivar ? `<button type="button" class="btn sm" data-archive="${esc(t.id)}">Arquivar</button>` : ''}
      </article>`).join('') || '<p>Nenhuma atividade nesta lista.</p>'}</div>`;
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
