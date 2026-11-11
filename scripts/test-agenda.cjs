const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {PGlite} = require(path.join(process.env.TEMP,'radar-agenda-qa','node_modules','@electric-sql','pglite'));
const {JSDOM} = require('../../_tmp_radar_checkbox_qa/node_modules/jsdom');
const {chromium} = require('../../_tmp_radar_checkbox_qa/node_modules/playwright');
const talitha = '7d1a7dfb-687a-4e7a-8cbb-f1f6342ce34f';
const clarice = '7f7bccf3-db53-47df-8946-578f57016381';
const other = '00000000-0000-0000-0000-000000000001';

(async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as
        'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
      create table public.radar_usuarios(auth_user_id uuid, status text);
      insert into auth.users values ('${talitha}'),('${clarice}'),('${other}');
      insert into public.radar_usuarios select id,'ativo' from auth.users;
    `);
    await db.exec(fs.readFileSync('database/agenda_talitha.sql','utf8'));
    const auth = async id => {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
      await db.exec('set role authenticated');
    };
    const rpc = async (action,data={}) => (await db.query(
      'select public.radar_agenda_talitha($1,$2::jsonb) result',[action,JSON.stringify(data)]
    )).rows[0].result;
    const draft = {titulo:'<img src=x onerror=alert(1)>',prazo:'2026-11-20'};
    await auth(clarice);
    const {tarefas:[assigned]} = await rpc('criar',draft);
    await auth(other);
    await assert.rejects(rpc('listar'),/Acesso restrito/);
    await db.exec('set role anon');
    await assert.rejects(rpc('listar'),/permission denied/);
    await auth(talitha);
    await assert.rejects(db.query('select * from radar_agenda.tarefas'),/permission denied/);
    await assert.rejects(rpc('arquivar',{id:assigned.id}),/Só Clarice/);
    await assert.rejects(rpc('atualizar',{id:assigned.id,status:'concluida',justificativa:'  '}),/justificativa/);
    const {tarefas} = await rpc('atualizar',{id:assigned.id,status:'concluida',justificativa:'Entregue.'});
    assert.equal(tarefas[0].arquivada_em,null);
    assert.equal(tarefas[0].pode_arquivar,false);
    assert.equal(tarefas[0].historico[0].autor,'Talitha');
    const own = (await rpc('criar',{...draft,titulo:'Tarefa própria'})).tarefas.find(t=>t.autor==='Talitha');
    await rpc('arquivar',{id:own.id});
    await auth(clarice);
    assert.ok((await rpc('arquivar',{id:assigned.id})).tarefas.every(t=>t.arquivada_em));
    await db.exec(`reset role; update radar_usuarios set status='inativo' where auth_user_id='${talitha}'`);
    await auth(talitha);
    await assert.rejects(rpc('listar'),/Acesso restrito/);

    const dom = new JSDOM('<div data-mod="agendaTalitha" hidden></div><div id="mod-agendaTalitha"></div>',{runScripts:'outside-only'});
    const w = dom.window;
    let id = other, opened = 0;
    w.getRadarUser = () => ({id});
    w.getSB = () => ({rpc:async()=>({data:{tarefas}})});
    w.go = mod => { assert.equal(mod,'agendaTalitha'); opened++; };
    w.eval(fs.readFileSync('agenda-talitha.js','utf8'));
    assert.equal(w.agendaInicio(),false);
    assert.equal(w.document.querySelector('[data-mod]').hidden,true);
    id = clarice;
    assert.equal(w.agendaInicio(),false);
    assert.equal(w.document.querySelector('[data-mod]').hidden,false);
    id = talitha;
    assert.equal(w.agendaInicio(),true);
    assert.equal(w.agendaInicio(),false);
    assert.equal(opened,1);
    await w.renderAgendaTalitha();
    assert.equal(w.document.querySelectorAll('.ag-item').length,1);
    assert.equal(w.document.querySelectorAll('img,[data-archive]').length,0);
    assert.match(w.document.querySelector('.ag-history').textContent,/Entregue/);
    w.agendaLimpar();
    assert.equal(w.document.querySelector('.ag-item'),null);
    w.close();
    const browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
    try {
      const page = await browser.newPage();
      for(const width of [390, 1440]) {
        await page.setViewportSize({width,height:800});
        await page.setContent('<main id="mod-agendaTalitha"></main>');
        await page.addStyleTag({path:'agenda-talitha.css'});
        await page.evaluate(({talitha,tarefas}) => {
          window.getRadarUser = () => ({id:talitha});
          window.go = () => {};
          window.getSB = () => ({rpc:async()=>({data:{tarefas}})});
        },{talitha,tarefas});
        await page.addScriptTag({path:'agenda-talitha.js'});
        await page.evaluate(()=>window.renderAgendaTalitha());
        await page.getByRole('button',{name:'Nova atividade'}).click();
        assert.equal(await page.getByLabel('Título').isVisible(),true);
        await page.getByText('Atualizar e ver histórico').click();
        assert.equal(await page.getByLabel('Justificativa').isVisible(),true);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      }
    } finally { await browser.close(); }
    console.log('Agenda: permissões, histórico, abertura e renderização conferidos.');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
