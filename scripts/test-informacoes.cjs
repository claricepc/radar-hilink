const fs=require('node:fs');
const assert=require('node:assert/strict');
const {chromium}=require('../../_tmp_radar_checkbox_qa/node_modules/playwright');
const {JSDOM}=require('../../_tmp_radar_checkbox_qa/node_modules/jsdom');
const html=fs.readFileSync('RADAR_HILINK.html','utf8');
const start=html.indexOf('const INF = {');
const end=html.indexOf('/* Botão fixo:',start);
assert.ok(start>0&&end>start);
const code=html.slice(start,end);
const dom=new JSDOM(html);
const styles=[...dom.window.document.querySelectorAll('style')].map(s=>s.textContent).join('\n');
const vgStart=html.indexOf("(function(){ if(document.getElementById('vg-css'))");
const vgEnd=html.indexOf('})();',vgStart)+5;
const text='Nossas opções de vencimento são os dias 5, 10, 15, 20 e 25. Se cair em sábado, domingo ou feriado, fica para o próximo dia útil apenas naquele mês.';
const fixture={planos:[{nome:'300 Mega',preco:'79,90'}],inclusos:['Wi-Fi em comodato'],beneficios:[],taxas:[{nome:'Instalação em Itamaracá · filial 5',valor:'150,00',detalhe:'Taxa mais pré-pago. Somente Itamaracá, Hilink Igarassu.'}],avulsos:[{nome:'Ponto Mesh',valor:'29,90',unidade:'por mês, por ponto',detalhe:'Cobertura'}],materiais:[{nome:'Cabo',valor:'21,00'}],cobranca:{vencimentos:[5,10,15,20,25],regra_dia_nao_util:'O ajuste vale somente naquele mês. O dia contratado permanece.',texto_cliente:text},links:[],procedimentos:[],acessos:[]};
(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const page=await browser.newPage();await page.route('**/*',r=>r.abort());
    await page.setContent(`<html data-radar-tema="claro"><head><style>${styles}body{display:block;padding:20px;background:var(--fundo)!important;color:var(--texto)!important}#mod-informacoes{display:block}</style></head><body><div id="mod-informacoes"></div></body></html>`);
    await page.addScriptTag({content:html.slice(vgStart,vgEnd)});
    await page.evaluate(()=>{window.STATE={activeMod:'informacoes'};window.toast=()=>{};window.copied='';Object.defineProperty(navigator,'clipboard',{value:{writeText:async t=>{window.copied=t;}}});});
    await page.addScriptTag({content:code});
    await page.evaluate(data=>{INF.dados=data;INF.meta={pode_editar:true};renderInformacoes();},fixture);
    assert.equal(await page.getByText('Ponto Mesh',{exact:true}).evaluate(e=>e.closest('[data-inf-sec]').getAttribute('data-inf-sec')),'taxas');
    assert.equal(await page.getByText('Instalação em Itamaracá · filial 5',{exact:true}).evaluate(e=>e.closest('[data-inf-sec]').getAttribute('data-inf-sec')),'taxas');
    assert.deepEqual(await page.locator('.inf-dia').allTextContents(),['5','10','15','20','25']);
    await page.getByRole('button',{name:'Copiar mensagem',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.copied),text);
    const headings=await page.locator('[data-inf-sec] h3').allTextContents();
    assert.equal(headings.length,3); // Empty unrelated categories do not create blank sections.
    assert.ok(headings[0].startsWith('1. Planos'));assert.ok(headings[1].startsWith('2. Taxas'));assert.ok(headings[2].startsWith('3. Vencimentos'));
    await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'qa-cp/informacoes-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:'qa-cp/informacoes-mobile.png',fullPage:true});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.evaluate(()=>infBuscar('itamaraca'));
    assert.ok(await page.getByText('Instalação em Itamaracá · filial 5',{exact:true}).isVisible());
    await page.evaluate(()=>{infBuscar('');infEditar();});
    await page.getByLabel('Mensagem para copiar e enviar ao cliente').fill('Mensagem editada');
    assert.equal(await page.evaluate(()=>INF.rascunho.cobranca.texto_cliente),'Mensagem editada');
    assert.equal(await page.evaluate(()=>INF.dados.cobranca.texto_cliente),text);
    console.log(JSON.stringify({ok:true,meshGrouped:true,regionalInstallation:true,copy:true,editorPreserved:true,mobile:true}));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
