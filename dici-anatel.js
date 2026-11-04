// ===== DICI Anatel do mês (dentro do alerta "Enviar DICI Anatel") =====
// Fluxo: arrastar os CSVs exportados do IXC -> o Radar corrige o formato (UTF-8 com BOM, CRLF, fibra/internet em minúsculo)
// e confere CNPJ, mês e total de acessos -> salva no Google Drive (pasta "MM - DICI SCM MÊS/AA") -> baixar para o portal
// -> anexar os recibos (filiais do portal) e marcar o e-mail da IG -> concluir o alerta (o banco confere se está tudo lá).
var DICI = { comp:null, ref:null, arquivos:[], registros:[], ativos:{}, enviando:false };
const DICI_FILIAIS = { '1':{nome:'Recife',slug:'recife'}, '4':{nome:'Madalena',slug:'madalena'}, '5':{nome:'Igarassu',slug:'igarassu'}, '6':{nome:'Jaboatão',slug:'jaboatao'}, '7':{nome:'IG (Cohab)',slug:'ig'} };
const DICI_PORTAL = ['1','4','5','6'], DICI_EMAIL = ['7'];
const DICI_CAB = 'CNPJ;ANO;MES;COD_IBGE;TIPO_CLIENTE;TIPO_ATENDIMENTO;TIPO_MEIO;TIPO_PRODUTO;TIPO_TECNOLOGIA;VELOCIDADE;ACESSOS';
function diciFilialPorCnpj(cnpj){
  const so = String(cnpj||'').replace(/\D/g,'');
  for(const f of ['1','4','5','6','7']){ const d = (typeof FILIAIS_DADOS_FATURAMENTO!=='undefined' && FILIAIS_DADOS_FATURAMENTO[f]) || null; if(d && String(d.cnpj).replace(/\D/g,'')===so) return f; }
  return null;
}
function diciNomeArq(f, cat, ext){ const [a,m] = DICI.ref.split('-'); return `${cat==='recibo'?'recibo_':''}dici_${a}_${m} (${DICI_FILIAIS[f]?.slug||('filial'+f)}).${ext}`; }
async function diciAbrir(comp){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(comp)){toast('Competencia invalida.','error');return;}
  if(DICI.enviando||DICI.arquivos.some(x=>x.salvando)){toast('Aguarde o salvamento em andamento.','error');return;}
  DICI.registros=[]; DICI.ativos={}; DICI.erroConsulta='';
  DICI.comp = comp; const d = new Date(comp+'-01T12:00:00'); d.setMonth(d.getMonth()-1);
  DICI.ref = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); DICI.arquivos = [];
  await diciRecarregar(); diciRender();
}
async function diciRecarregar(){
  try{ const sb = getSB();
    const [a, b] = await Promise.all([sb.rpc('radar_obrig_arquivos',{p_tipo:'dici',p_competencia:DICI.ref}), sb.rpc('radar_dici_ativos')]);
    if(a.error||b.error)throw new Error(a.error?.message||b.error?.message);
    DICI.registros = a.data||[]; DICI.ativos = b.data||{}; DICI.erroConsulta='';
  }catch(e){DICI.registros=[];DICI.ativos={};DICI.erroConsulta='Nao foi possivel conferir os registros: '+e.message;}
}
function diciLer(arq){
  return new Promise((ok)=>{ const r = new FileReader(); r.onload = () => { const buf = r.result;
    let t = new TextDecoder('utf-8').decode(buf); if(t.includes('�')) t = new TextDecoder('windows-1252').decode(buf); ok(t); }; r.readAsArrayBuffer(arq); });
}
function diciCorrigir(texto, nomeOrig){
  const out = { nomeOrig, erros:[], avisos:[], filial:null, linhas:0, acessos:0 };
  if(!window.Papa){out.erros.push('Leitor CSV indisponivel. Recarregue a pagina.');return out;}
  const parsed=Papa.parse(texto.replace(/^﻿/,''),{delimiter:';',skipEmptyLines:'greedy'});
  if(parsed.errors.length){out.erros.push('CSV invalido: '+parsed.errors[0].message);return out;}
  const L=parsed.data.map(row=>row.map(c=>String(c).trim()));
  if(!L.length){ out.erros.push('Arquivo vazio.'); return out; }
  const cab = L[0].map(c=>c.toUpperCase()).join(';');
  if(cab !== DICI_CAB){ out.erros.push('Cabeçalho diferente do padrão da Anatel.'); return out; }
  const [ra, rm] = DICI.ref.split('-').map(Number), cnpjs = new Set(), ruins = [];
  const linhas = L.slice(1).map((c,i)=>{ if(c.length!==11){ ruins.push(i+2); return null; }
    c[0] = c[0].replace(/\D/g,''); cnpjs.add(c[0]);
    if(+c[1]!==ra || +c[2]!==rm) out.mesErrado = `${c[2]}/${c[1]}`;
    c[6] = c[6].toLowerCase(); c[7] = c[7].toLowerCase();
    if(!/^\d+$/.test(c[10])||!Number.isSafeInteger(Number(c[10])))out.erros.push('Linha '+(i+2)+': acessos deve ser inteiro nao negativo.');
    if(!/^\d{7}$/.test(c[3]))out.erros.push('Linha '+(i+2)+': codigo IBGE deve ter 7 digitos.');
    if(c.some(v=>!v))out.erros.push('Linha '+(i+2)+': campo obrigatorio vazio.');
    out.acessos += /^\d+$/.test(c[10])?Number(c[10]):0; return c; }).filter(Boolean);
  if(!linhas.length)out.erros.push('Arquivo sem linhas de dados.');
  if(ruins.length) out.erros.push(`Linha(s) com colunas a mais ou a menos: ${ruins.slice(0,5).join(', ')}.`);
  if(cnpjs.size !== 1) out.erros.push('O arquivo tem mais de um CNPJ.');
  out.filial = diciFilialPorCnpj([...cnpjs][0]); out.cnpj = [...cnpjs][0];
  if(!out.filial) out.erros.push(`CNPJ ${[...cnpjs][0]||''} não é de nenhuma filial da DICI.`);
  if(out.mesErrado) out.erros.push(`O arquivo é de ${out.mesErrado}, mas a DICI agora é de ${String(rm).padStart(2,'0')}/${ra}.`);
  out.linhas = linhas.length;
  const ativos = out.filial==='1' ? (+DICI.ativos['1']||0)+(+DICI.ativos['3']||0) : (+DICI.ativos[out.filial]||0);
  out.ativos = ativos;
  if(ativos && Math.abs(out.acessos-ativos)/ativos > 0.10) out.avisos.push(`Total de acessos (${cdNum(out.acessos)}) está ${out.acessos>ativos?'acima':'abaixo'} dos ${cdNum(ativos)} contratos ativos hoje no Radar. Confira o filtro do relatório no IXC.`);
  out.texto = '﻿' + Papa.unparse([DICI_CAB.split(';'),...linhas],{delimiter:';',newline:'\r\n'}) + '\r\n';
  return out;
}
async function diciArquivos(input){
  if(DICI.enviando||DICI.arquivos.some(x=>x.salvando)){toast('Aguarde o salvamento em andamento.','error');return;}
  const lista = [...(input.files||[])]; input.value = '';
  for(const a of lista){ const r = diciCorrigir(await diciLer(a), a.name); DICI.arquivos = DICI.arquivos.filter(x=>!(r.filial && x.filial===r.filial)); DICI.arquivos.push(r); }
  diciRender();
}
function diciB64Texto(t){ const b = new TextEncoder().encode(t); let s = ''; for(let i=0;i<b.length;i+=0x8000) s += String.fromCharCode.apply(null, b.subarray(i,i+0x8000)); return btoa(s); }
function diciB64Arq(arq){ return new Promise(ok=>{ const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.readAsDataURL(arq); }); }
async function diciEnviar(corpo){
  const r = await getSB().functions.invoke('drive-enviar', { body: corpo });
  if(r.error){ let m = r.error.message; try{ const j = await r.error.context.json(); m = j.erro || m; }catch(e){} throw new Error(m); }
  if(!r.data?.ok) throw new Error(r.data?.erro || 'falha ao salvar no Drive'); return r.data;
}
async function diciSalvarDrive(r){
  if(!r||r.erros.length||r.salvando||DICI.erroConsulta)return;
  r.erroDrive='';
  r.salvando = true; diciRender();
  try{ const nome = diciNomeArq(r.filial,'arquivo','csv');
    const d = await diciEnviar({ tipo:'dici', competencia:DICI.ref, filial:r.filial, categoria:'arquivo', nome, mime:'text/csv', base64:diciB64Texto(r.texto), detalhe:{ acessos:r.acessos, linhas:r.linhas, original:r.nomeOrig } });
    r.salvo = d.url; r.nome = nome; await diciRecarregar(); }
  catch(e){ r.erroDrive = e.message; toast('Drive: '+e.message,'error'); }
  finally{ r.salvando = false; diciRender(); }
}
function diciBaixar(f){
  const r = DICI.arquivos.find(x=>x.filial===f); if(!r) return;
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([r.texto],{type:'text/csv;charset=utf-8'})); a.download = diciNomeArq(f,'arquivo','csv'); document.body.appendChild(a); a.click(); a.remove();
}
async function diciRecibo(f, input){
  const arq = input.files && input.files[0]; input.value = ''; if(!arq) return;
  const ext = (arq.name.split('.').pop()||'pdf').toLowerCase();
  DICI.enviando = true; diciRender();
  try{ await diciEnviar({ tipo:'dici', competencia:DICI.ref, filial:f, categoria:'recibo', nome:diciNomeArq(f,'recibo',ext), mime:arq.type||'application/pdf', base64:await diciB64Arq(arq) });
    toast('Recibo salvo no Drive.','success'); await diciRecarregar(); }
  catch(e){ toast('Recibo: '+e.message,'error'); }
  finally{ DICI.enviando = false; diciRender(); }
}
async function diciMarcarEmail(f){
  try{ const r = await getSB().rpc('radar_obrig_marcar',{ p_tipo:'dici', p_competencia:DICI.ref, p_filial:f, p_categoria:'email', p_nome:'enviado por e-mail para contato@acisp.net.br' });
    if(r.error) throw new Error(r.error.message); await diciRecarregar(); diciRender(); toast('Envio por e-mail registrado.','success'); }
  catch(e){ toast(e.message,'error'); }
}
function diciRender(){
  if(!document.getElementById('dici-css')){ const st=document.createElement('style'); st.id='dici-css'; st.textContent='.dici-tag{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;text-decoration:none}.dici-tag.ok{background:#dcfce7;color:#166534}.dici-tag.ab{background:#fef3c7;color:#92400e}.dici-tag.ruim{background:#fee2e2;color:#991b1b}.dici-tag.cinza{background:#e2e8f0;color:#334155}#cd-conf-modal .cdg-modal-box{max-width:860px;width:calc(100vw - 32px)}'; document.head.appendChild(st); }
  const [a,m] = DICI.ref.split('-'), reg = DICI.registros||[];
  const tem = (f,cat) => reg.filter(x=>x.filial===f && x.categoria===cat).slice(-1)[0];
  const pasta = reg.map(x=>x.detalhe&&x.detalhe.pastaUrl).filter(Boolean).slice(-1)[0];
  const assunto = encodeURIComponent(`DICI SCM ${m}/${a} - IG Telecom`);
  const linhaFilial = f => {
    const info = DICI_FILIAIS[f], arq = DICI.arquivos.find(x=>x.filial===f), noDrive = tem(f,'arquivo'), rec = tem(f,'recibo'), mail = tem(f,'email');
    const portal = DICI_PORTAL.includes(f);
    let st = '';
    if(arq && arq.erros.length) st = `<span class="dici-tag ruim">${cdEsc(arq.erros[0])}</span>`;
    else if(arq && arq.salvando) st = '<span class="dici-tag ab">Salvando no Drive...</span>';
    else if(arq && !arq.salvo && !arq.erroDrive) st = `<span class="dici-tag ab">Conferido, aguardando salvar</span> <button class="btn sm outline" ${DICI.erroConsulta?'disabled':''} onclick="diciSalvarDrive(DICI.arquivos.find(x=>x.filial==='${f}'))">${noDrive?'Salvar nova versao no Drive':'Salvar no Drive'}</button>`;
    else if(noDrive) st = `<a class="dici-tag ok" href="${cdEsc(noDrive.drive_url)}" target="_blank" rel="noopener">Arquivo no Drive</a>`;
    else if(arq && arq.erroDrive) st = `<span class="dici-tag ruim">Drive: ${cdEsc(arq.erroDrive)}</span> <button class="btn sm outline" onclick="diciSalvarDrive(DICI.arquivos.find(x=>x.filial==='${f}'))">Tentar de novo</button>`;
    else if(arq) st = '<span class="dici-tag ab">Corrigido, ainda não salvo no Drive</span>';
    else st = '<span class="dici-tag cinza">Falta o arquivo do IXC</span>';
    const avisos = arq && arq.avisos.length ? `<div style="font-size:11px;color:var(--radar-orange);margin-top:3px">${cdEsc(arq.avisos[0])}</div>` : '';
    const dados = arq && !arq.erros.length ? `<div style="font-size:11px;opacity:.75;margin-top:3px">${cdNum(arq.linhas)} linhas · ${cdNum(arq.acessos)} acessos · ${cdNum(arq.ativos)} contratos ativos no Radar</div>` : (noDrive&&noDrive.detalhe&&noDrive.detalhe.acessos?`<div style="font-size:11px;opacity:.75;margin-top:3px">${cdNum(noDrive.detalhe.acessos)} acessos</div>`:'');
    const baixar = arq && !arq.erros.length ? `<button class="btn sm outline" onclick="diciBaixar('${f}')">Baixar para enviar</button>` : '';
    const fim = portal
      ? (rec ? `<a class="dici-tag ok" href="${cdEsc(rec.drive_url)}" target="_blank" rel="noopener">Recibo anexado</a>` : `<label class="btn sm ${noDrive?'primary':'outline'}" style="cursor:pointer">Anexar recibo da Anatel<input type="file" accept=".pdf,image/*" style="display:none" ${DICI.enviando?'disabled':''} onchange="diciRecibo('${f}',this)"></label>`)
      : (mail ? '<span class="dici-tag ok">E-mail enviado</span>' : `<a class="btn sm outline" href="mailto:contato@acisp.net.br?cc=caroline@hilink.com.br&subject=${assunto}" title="Anexe o arquivo baixado. A ACISP faz o envio no portal da Anatel.">Abrir e-mail</a> <button class="btn sm ${noDrive?'primary':'outline'}" onclick="diciMarcarEmail('${f}')">Já enviei o e-mail</button>`);
    return `<tr><td><b>${cdEsc(info.nome)}</b><br><small style="opacity:.7">filial ${f} · ${portal?'você envia no portal da Anatel':'só o arquivo por e-mail; a ACISP envia na Anatel'}</small></td><td>${st}${dados}${avisos}</td><td style="white-space:nowrap">${baixar} ${fim}</td></tr>`;
  };
  const todos = !DICI.erroConsulta && !DICI.arquivos.some(r=>r.erros.length||!r.salvo||r.salvando) && [...DICI_PORTAL,...DICI_EMAIL].every(f=>tem(f,'arquivo')) && DICI_PORTAL.every(f=>tem(f,'recibo')) && DICI_EMAIL.every(f=>tem(f,'email'));
  cdModal(`<h3>DICI Anatel de ${m}/${a}</h3>
    ${DICI.erroConsulta?`<p role="alert" style="color:var(--radar-red)">${cdEsc(DICI.erroConsulta)}</p>`:''}
    <ol style="margin:0 0 12px 18px;padding:0;font-size:13px;line-height:1.6">
      <li>No IXC, exporte o arquivo DICI de cada filial (1, 4, 5, 6 e 7) e arraste todos aqui. Confira os resultados e clique em Salvar no Drive.</li>
      <li>Clique em "Baixar para enviar". Filiais 1, 4, 5 e 6: você envia no portal da Anatel. IG: mande só o arquivo por e-mail para a ACISP, que faz o envio por lá (não tem recibo).</li>
      <li>Anexe o recibo da Anatel das filiais 1, 4, 5 e 6 e marque "Já enviei o e-mail" da IG. Aí o alerta pode ser concluído.</li>
    </ol>
    <label style="display:block;border:2px dashed var(--linha);border-radius:10px;padding:16px;text-align:center;cursor:pointer;margin-bottom:12px">
      <b>Clique ou arraste aqui os arquivos CSV do IXC</b><br><small style="opacity:.7">pode mandar os cinco de uma vez</small>
      <input type="file" accept=".csv,text/csv" multiple style="display:none" onchange="diciArquivos(this)"></label>
    <div style="overflow:auto"><table class="tbl" style="width:100%;font-size:12px"><thead><tr><th>Filial</th><th>Arquivo</th><th>Envio</th></tr></thead>
      <tbody>${[...DICI_PORTAL, ...DICI_EMAIL].map(linhaFilial).join('')}</tbody></table></div>
    ${DICI.arquivos.filter(x=>x.erros.length && !x.filial).map(x=>`<p class="cdg-nota" style="color:var(--radar-red)">${cdEsc(x.nomeOrig)}: ${cdEsc(x.erros.join(' '))}</p>`).join('')}
    ${pasta?`<p class="cdg-nota" style="margin:10px 0 0"><a href="${cdEsc(pasta)}" target="_blank" rel="noopener">Abrir a pasta do mês no Drive</a></p>`:''}
    <div class="cdg-modal-acoes" style="margin-top:14px"><button type="button" class="btn sm" onclick="cdModal(null)">Fechar</button>
      <button type="button" class="btn sm primary" ${todos?'':'disabled title="Falta anexar recibos ou marcar o e-mail"'} onclick="radarLembreteConcluir('dici_anatel','${cdEsc(DICI.comp)}')">Concluir a DICI do mês</button></div>`);
  const bx = document.querySelector('#cd-conf-modal .cdg-modal-box'); if(bx){ bx.style.maxWidth='880px'; bx.style.width='calc(100vw - 32px)'; }
  const box = document.getElementById('cd-conf-modal');
  if(box && !box.dataset.diciDrop){ box.dataset.diciDrop = '1';
    box.addEventListener('dragover', e=>{ e.preventDefault(); });
    box.addEventListener('drop', e=>{ e.preventDefault(); const dt = e.dataTransfer; if(dt && dt.files && dt.files.length) diciArquivos({ files: dt.files, set value(v){} }); }); }
}
Object.assign(window, { DICI, diciAbrir, diciArquivos, diciBaixar, diciRecibo, diciMarcarEmail, diciSalvarDrive });

