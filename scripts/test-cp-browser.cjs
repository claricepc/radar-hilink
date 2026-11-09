const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require('../../_tmp_radar_checkbox_qa/node_modules/playwright');
const {JSDOM}=require('../../_tmp_radar_checkbox_qa/node_modules/jsdom');
const html=fs.readFileSync('RADAR_HILINK.html','utf8');
const dom=new JSDOM(html);
const styles=[...dom.window.document.querySelectorAll('style')].map(m=>m.textContent).join('\n');
const css=fs.readFileSync('contas-pagar.css','utf8');
const code=fs.readFileSync('contas-pagar.js','utf8');
const fixture={ok:true,fonte:'Financeiro existente (DADOS SINTÉTICOS DE TESTE)',consultado_em:'2026-11-09T16:00:00Z',empresas:[{id:'00000000-0000-0000-0000-000000000001',codigo:'RECIFE',extrato_ate:'2026-08-31'}],resumo:{registros:12,previsto:1800,realizado:1200,sem_classificacao:2,realizado_sem_data:1},rows:[],total:0};
(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',r=>r.abort());
    await page.setContent(`<html lang="pt-BR"><head><style>${styles}\n${css}\nbody{display:block;margin:0;padding:24px}#mod-cp{display:block;padding:16px}#cp-nav[hidden]{display:none}</style></head><body data-active-mod="cp"><nav id="cp-nav" hidden></nav><div id="mod-cp"></div></body></html>`);
    await page.evaluate(f=>{
      window.SUPABASE_URL='https://example.test';window.SUPABASE_ANON='PUBLIC_TEST_KEY';
      window.getSB=()=>({auth:{getUser:async()=>({data:{user:{id:'test'}}}),getSession:async()=>({data:{session:{access_token:'TEST'}}}),onAuthStateChange:()=>{}},rpc:async()=>({data:true})});
      window.calls=[];window.replyMode='ok';
      window.fetch=async(url,opts)=>{
        const b=JSON.parse(opts.body);window.calls.push(b);
        if(window.replyMode==='error')return {ok:false,json:async()=>({erro:'Fonte indisponível. Nenhum valor foi atualizado.'})};
        if(window.replyMode==='slow'){await new Promise(r=>setTimeout(r,250));}
        const d=structuredClone(f);
        if(b.view==='lancamentos'||b.view==='agenda')d.rows=[{id:'TESTE-123',filial:'RECIFE',descricao:'Fornecedor de teste <img src=x onerror=alert(1)>',data_competencia:'2026-10-01',data_vencimento:'2026-10-10',valor_previsto:100,valor_realizado:null,status:'PROVISIONADO'}];
        if(b.view==='dre')d.rows=[{grupo:'Despesa de teste',registros:1,previsto:100,realizado:null}];
        if(b.view==='razao')d.rows=[{filial:'RECIFE',data_lancamento:'2026-10-01',historico:'Teste',conta_codigo:'1',lado:'D',valor:100}];
        if(b.view==='caixa'||b.view==='conciliacao')d.rows=[{filial:'RECIFE',data_transacao:'2026-10-01',descricao_banco:'Teste',valor:100,status_conc:'PENDENTE',alerta:'Conferir filial da conta'}];
        if(b.view==='auditoria'){d.rows=[{filial:'RECIFE',id:'TESTE-123',alerta:'Sem classificação contábil',origem:'Planilha de teste, linha 10'}];d.registrados=[{filial:'TODAS',competencia:'2026-10',teste:'Conferência anterior (teste)',diferenca:10}];}
        return {ok:true,json:async()=>d};
      };
    },fixture);
    await page.addScriptTag({content:code});
    await page.evaluate(()=>renderContasPagar());
    await page.waitForFunction(()=>document.querySelector('#cp-result')?.textContent.includes('1.800'));
    await page.setViewportSize({width:1440,height:900});
    await page.screenshot({path:'qa-cp/desktop-resumo.png',fullPage:true});
    for(const view of ['lancamentos','agenda','dre','razao','caixa','conciliacao','auditoria']){
      await page.locator(`[data-view="${view}"]`).click();
      await page.waitForFunction(v=>window.calls.at(-1)?.view===v,view);
      await page.waitForTimeout(20);
      assert.ok((await page.locator('#cp-result').innerText()).length>20);
      assert.equal(await page.locator('#cp-result img').count(),0,'Unescaped source data');
    }
    assert.ok((await page.locator('#cp-result').innerText()).includes('Achados já registrados'));
    await page.screenshot({path:'qa-cp/desktop-auditoria.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:'qa-cp/mobile-auditoria.png',fullPage:true});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Page horizontal overflow');
    await page.evaluate(()=>window.replyMode='error');
    await page.locator('[data-view="resumo"]').click();
    await page.waitForFunction(()=>document.querySelector('#cp-result').textContent.includes('Fonte indisponível'));
    assert.ok(!(await page.locator('#cp-result').innerText()).includes('R$ 0'));
    await page.evaluate(()=>{window.replyMode='slow';});
    await page.locator('[data-view="lancamentos"]').click();
    await page.evaluate(()=>{document.body.dataset.activeMod='inicio';cpClear();});
    await page.waitForTimeout(350);
    assert.equal(await page.locator('#mod-cp').innerText(),'');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({ok:true,tabs:8,desktop:'1440x900',mobile:'390x844',errors}));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
