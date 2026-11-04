// Source adapter for the declaration only; never writes to IXC or STATE.raw.
window.FAT_IXC={status:'vazio',chave:'',linhas:[],carteiras:[],timer:null,geracao:0,erro:''};
function fatConsultaChave(){
  return JSON.stringify([document.getElementById('fat-data-de')?.value||'',document.getElementById('fat-data-ate')?.value||'',fatFiliaisSelecionadas()]);
}
function fatFontePronta(){return FAT_IXC.status==='pronto'&&FAT_IXC.chave===fatConsultaChave();}
function fatFonteErro(){
  if(fatFiliaisSelecionadas()?.length===0)return 'Selecione ao menos uma filial.';
  if(fatCarteirasSelecionadas()?.length===0)return 'Selecione ao menos uma carteira.';
  if(FAT_IXC.chave!==fatConsultaChave())return 'Periodo ou filiais alterados. Consulte os recebimentos para atualizar o relatorio.';
  return FAT_IXC.erro||'Consulte os recebimentos para preparar o relatorio completo.';
}
function fatPodeExportar(){
  if(!fatFontePronta()||fatFiliaisSelecionadas()?.length===0||fatCarteirasSelecionadas()?.length===0){toast(fatFonteErro(),'error');return false;}
  return true;
}
function fatFonteStatusRender(){
  const el=document.getElementById('fat-source-state');
  if(el){
    let msg=fatFonteErro();
    if(FAT_IXC.chave===fatConsultaChave()){
      if(FAT_IXC.status==='buscando'||FAT_IXC.status==='mapeando')msg=(FAT_IXC.status==='mapeando'?'Identificando as carteiras':'Consultando movimentos')+' · '+Number(FAT_IXC.movimentos||0).toLocaleString('pt-BR')+' movimentos lidos';
      if(fatFontePronta())msg='Recebimentos por data do movimento · valor liquido · atualizado em '+new Date(FAT_IXC.atualizado_em).toLocaleString('pt-BR')+(FAT_IXC.sem_carteira?' · '+FAT_IXC.sem_carteira+' titulo(s) sem carteira identificada':'');
    }
    el.textContent=msg;
    el.style.color=FAT_IXC.status==='erro'?'#ef4444':'';
  }
  document.querySelectorAll('[data-fat-export]').forEach(el=>el.disabled=!fatFontePronta()||fatFiliaisSelecionadas()?.length===0||fatCarteirasSelecionadas()?.length===0);
  const button=document.getElementById('fat-consultar');
  if(button){button.disabled=['buscando','mapeando'].includes(FAT_IXC.status)&&FAT_IXC.chave===fatConsultaChave();}
}
async function fatRpc(nome,args){
  const controle=new AbortController();let timer;
  try{
    return await Promise.race([getSB().rpc(nome,args).abortSignal(controle.signal),new Promise((_,reject)=>{timer=setTimeout(()=>{controle.abort();reject(new Error('A consulta demorou. Tente novamente.'));},30000);})]);
  }finally{clearTimeout(timer);}
}
async function fatAtualizarIxc(){
  const cfg=fatConfig();
  if(!cfg.de||!cfg.ate||cfg.ate<cfg.de||fatFiliaisSelecionadas()?.length===0){toast('Selecione um periodo valido e ao menos uma filial.','error');return;}
  const chave=fatConsultaChave(),de=document.getElementById('fat-data-de').value,ate=document.getElementById('fat-data-ate').value,filiais=fatFiliaisSelecionadas();
  const geracao=++FAT_IXC.geracao;
  clearTimeout(FAT_IXC.timer);
  Object.assign(FAT_IXC,{status:'buscando',chave,erro:'',movimentos:0});
  renderFaturamentoPreview();
  try{
    const r=await fatRpc('radar_faturamento_solicitar',{p_de:de,p_ate:ate,p_filiais:filiais});
    if(r.error)throw new Error(r.error.message);
    if(geracao!==FAT_IXC.geracao)return;
    FAT_IXC.id=r.data;
    await fatConsultarResultado(geracao);
  }catch(e){if(geracao===FAT_IXC.geracao){FAT_IXC.status='erro';FAT_IXC.erro=e.message;renderFaturamentoPreview();}}
}
async function fatConsultarResultado(geracao){
  try{
    const r=await fatRpc('radar_faturamento_resultado',{p_carga:FAT_IXC.id});
    if(geracao!==FAT_IXC.geracao)return;
    if(r.error)throw new Error(r.error.message);
    const d=r.data;
    if(!d||d.id!==FAT_IXC.id||!['buscando','mapeando','pronto','erro'].includes(d.status))throw new Error('Resposta inesperada do faturamento.');
    const returned=JSON.stringify([d.de,d.ate,d.filiais===null?null:[...d.filiais].sort((a,b)=>a.localeCompare(b,'pt-BR',{numeric:true}))]);
    if(returned!==FAT_IXC.chave)throw new Error('O periodo da resposta nao corresponde ao solicitado.');
    if(d.status==='erro')throw new Error(d.erro||'Nao foi possivel completar a consulta.');
    if(d.status==='pronto'&&(!Array.isArray(d.linhas)||!Array.isArray(d.carteiras)))throw new Error('Resultado incompleto.');
    Object.assign(FAT_IXC,d);
    renderFaturamentoPreview();
    if(d.status!=='pronto')FAT_IXC.timer=setTimeout(()=>fatConsultarResultado(geracao),4000);
  }catch(e){if(geracao===FAT_IXC.geracao){FAT_IXC.status='erro';FAT_IXC.erro=e.message;renderFaturamentoPreview();}}
}
function fatBuildMovReport(){
  const cfg=fatConfig(),groups=new Map(),carteiras=fatCarteirasSelecionadas();
  const total={valor:0,recebido:0,aberto:0,cancelado:0,titulos:0,clientes:0,recebidos:0,abertos:0};
  if(!fatFontePronta())return {rows:[],total,cfg,cols:{},rawCount:0};
  for(const r of FAT_IXC.linhas){
    if(carteiras!==null&&!carteiras.includes(r.carteira))continue;
    const filial=cfg.modo==='filial'?r.filial:'Consolidado',key=filial+'|'+r.mes;
    if(!groups.has(key))groups.set(key,{filial,mes:r.mes,centavos:0,titulos:0,valor:0,aberto:0,cancelado:0,clientesCount:0,recebidos:0,abertos:0});
    const g=groups.get(key),value=Number(r.recebido);
    if(!Number.isFinite(value))throw new Error('Valor de recebimento invalido.');
    g.centavos+=Math.round(value*100);g.titulos+=Number(r.recebimentos||0);
  }
  // A successfully completed empty month is zero; an incomplete source is never zero.
  const filiais=cfg.modo==='filial'?(fatFiliaisSelecionadas()||[...new Set(FAT_IXC.linhas.map(r=>r.filial))]):['Consolidado'];
  if(cfg.de&&cfg.ate)for(const f of filiais){
    for(let d=new Date(cfg.de.getFullYear(),cfg.de.getMonth(),1);d<=cfg.ate;d.setMonth(d.getMonth()+1)){
      const mes=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'),key=f+'|'+mes;
      if(!groups.has(key))groups.set(key,{filial:f,mes,centavos:0,titulos:0,valor:0,aberto:0,cancelado:0,clientesCount:0,recebidos:0,abertos:0});
    }
  }
  const rows=[...groups.values()].sort((a,b)=>a.filial.localeCompare(b.filial,'pt-BR')||a.mes.localeCompare(b.mes)).map(g=>{
    g.recebidoAuto=g.centavos/100;g.recebido=g.recebidoAuto;
    if(cfg.manual){const v=fatManualValue(fatManualKey(g));if(v!==null){g.recebido=v;g.manual=true;}}
    return g;
  });
  total.recebido=rows.reduce((s,g)=>s+Math.round(g.recebido*100),0)/100;
  total.titulos=rows.reduce((s,g)=>s+g.titulos,0);
  return {rows,total,cfg,cols:{},rawCount:FAT_IXC.linhas.length};
}
