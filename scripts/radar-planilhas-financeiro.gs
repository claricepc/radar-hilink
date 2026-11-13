/**
 * Radar Hilink - leitura diaria das planilhas financeiras (Contas a pagar).
 *
 * SO LE as planilhas. Nao escreve nada nelas.
 * Envia as abas de 2026 (colunas A a E) para o Radar, que monta a agenda de pagamentos.
 * A planilha da Madalena e Excel: o script cria uma copia temporaria em Google Planilhas,
 * le e manda essa copia para a lixeira logo em seguida. O arquivo original nao e tocado.
 *
 * Como instalar (uma vez):
 *  1. script.google.com > Novo projeto > apague o conteudo e cole este arquivo > Salvar.
 *  2. Escolha a funcao "lerPlanilhas" no topo e clique em Executar. Autorize com a conta dona das planilhas.
 *  3. Escolha a funcao "instalarGatilho" e clique em Executar. Ela agenda a leitura todo dia as 6h.
 *
 * Leitura ao vivo (12/11/2026):
 *  - "converterMadalena": cria a versao Google Planilhas definitiva da Madalena na mesma pasta,
 *    da edicao para Caroline, Urbano e clarice@hilink (sem e-mail) e renomeia o Excel para ANTIGO.
 *    Rode UMA vez, com a Caroline fora do arquivo.
 *  - "instalarGatilhoEdicao": a cada edicao numa aba de 2026, aquela aba vai para o Radar na hora.
 */
var FUNCAO = 'https://mdhexsdnavzforuahgxn.supabase.co/functions/v1/planilha-financeiro';
var FONTES = [
  { filial: 'RECIFE',     id: '1HGgCNT41cwdCWETAfNflTY7vuOPhlzJUa-o1rg3fSlI', formato: 'sheets' },
  { filial: 'JABOATAO',   id: '1AChJlZDdC2AmSq9-lPNn40C-ICqxvzjfepu6awNLQmI', formato: 'sheets' },
  { filial: 'ITAPISSUMA', id: '1livVwCSYnZ0CdweRiRzfyzfmCosmA8tLGFHdoIaclXk', formato: 'sheets' },
  { filial: 'IG',         id: '1kcBYnU3CNcs-HWeS3uKkOTgrjw6Lm1DZfARKyr-DK5w', formato: 'sheets' },
  { filial: 'MADALENA',   id: '1CxdIXa4mqYsxvLoLXuflMQA3_yHasq3I',             formato: 'xlsx' },
  { filial: 'CAMARAGIBE', id: '1b81Eytd1lKgCMtr4QfuyyeQfS2bU8hY8Eh8VNM0x7dQ', formato: 'sheets' }
];
var ABA_2026 = /^[^A-Za-zÀ-ú]*(JANEIRO|FEVEREIRO|MAR[CÇ]O|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO)\s*\/?\s*(2026|26)\s*$/i;
var MAX_LINHAS = 400;

/** Fontes com a Madalena trocada pela versao Google Planilhas, depois da conversao. */
function fontes() {
  var idMad = PropertiesService.getScriptProperties().getProperty('MADALENA_SHEETS_ID');
  return FONTES.map(function (f) {
    return f.filial === 'MADALENA' && idMad ? { filial: f.filial, id: idMad, formato: 'sheets' } : f;
  });
}

function lerPlanilhas() {
  Logger.log('Conta: ' + Session.getActiveUser().getEmail());
  fontes().forEach(function (f) { enviar(f); });
}

/** Envia uma filial. Se "soAba" vier, manda so essa aba (leitura ao vivo). */
function enviar(f, soAba, quem) {
  var corpo = { filial: f.filial }, tmp = null;
  try {
    var arq = DriveApp.getFileById(f.id);
    corpo.modificado_em = arq.getLastUpdated().toISOString();
    var id = f.id;
    if (f.formato === 'xlsx') { tmp = converter(arq); id = tmp; }
    var ss = SpreadsheetApp.openById(id);
    if (quem) corpo.modificado_por = quem;
    corpo.abas = ss.getSheets().filter(function (sh) { return ABA_2026.test(sh.getName()) && (!soAba || sh.getName() === soAba); }).map(function (sh) {
      var n = Math.min(Math.max(sh.getLastRow(), 1), MAX_LINHAS);
      return { nome: sh.getName(), linhas: sh.getRange(1, 1, n, 5).getDisplayValues() };
    });
  } catch (e) {
    corpo.erro = String(e);
  } finally {
    if (tmp) { try { DriveApp.getFileById(tmp).setTrashed(true); } catch (e2) {} }
  }
  var r = UrlFetchApp.fetch(FUNCAO, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(Object.assign(corpo, { token: ScriptApp.getOAuthToken() })), muteHttpExceptions: true
  });
  Logger.log(f.filial + ': ' + r.getResponseCode() + ' ' + r.getContentText());
}

/** Cria copia temporaria do Excel em Google Planilhas (o original fica como esta). */
function converter(arq) {
  var blob = arq.getBlob(), b = 'radar' + Date.now();
  var meta = { name: '_tmp_radar_' + arq.getName(), mimeType: MimeType.GOOGLE_SHEETS };
  var ini = Utilities.newBlob('--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) +
    '\r\n--' + b + '\r\nContent-Type: ' + blob.getContentType() + '\r\n\r\n').getBytes();
  var fim = Utilities.newBlob('\r\n--' + b + '--').getBytes();
  var r = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'post', contentType: 'multipart/related; boundary=' + b, payload: ini.concat(blob.getBytes()).concat(fim),
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true
  });
  if (r.getResponseCode() >= 300) throw new Error('conversao do Excel falhou: ' + r.getContentText().slice(0, 200));
  return JSON.parse(r.getContentText()).id;
}

/** Agenda a leitura todo dia entre 6h e 7h. Rode uma vez. */
function instalarGatilho() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'lerPlanilhas') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('lerPlanilhas').timeBased().everyDays(1).atHour(6).create();
  Logger.log('Leitura diaria agendada para 6h.');
}

/** Leitura ao vivo: gatilho de edicao em cada planilha Google (rode uma vez; rode de novo depois de converter a Madalena). */
function instalarGatilhoEdicao() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var h = t.getHandlerFunction();
    if (h === 'aoEditar' || h === 'aoAlterar') ScriptApp.deleteTrigger(t);
  });
  fontes().filter(function (f) { return f.formato === 'sheets'; }).forEach(function (f) {
    var ss = SpreadsheetApp.openById(f.id);
    ScriptApp.newTrigger('aoEditar').forSpreadsheet(ss).onEdit().create();
    ScriptApp.newTrigger('aoAlterar').forSpreadsheet(ss).onChange().create();
    Logger.log('Leitura ao vivo ligada: ' + f.filial);
  });
}

function filialDaPlanilha(id) {
  var f = fontes().filter(function (x) { return x.id === id; })[0];
  return f || null;
}

/** Edicao de celula: manda so a aba editada. */
function aoEditar(e) {
  var ss = e.source, sh = e.range.getSheet(), f = filialDaPlanilha(ss.getId());
  if (!f || !ABA_2026.test(sh.getName())) return;
  var trava = LockService.getScriptLock();
  if (!trava.tryLock(20000)) return;
  try { enviar(f, sh.getName(), e.user ? String(e.user.getEmail ? e.user.getEmail() : e.user) : null); } finally { trava.releaseLock(); }
}

/** Linha/coluna inserida ou apagada, aba nova: manda todas as abas de 2026 da planilha. */
function aoAlterar(e) {
  if (e && e.changeType === 'EDIT') return; // edicao comum ja vai pelo aoEditar
  var f = filialDaPlanilha(e.source.getId());
  if (!f) return;
  var trava = LockService.getScriptLock();
  if (!trava.tryLock(30000)) return;
  try { enviar(f); } finally { trava.releaseLock(); }
}

/** Conversao definitiva da Madalena para Google Planilhas. Rode UMA vez, com a Caroline fora do arquivo. */
function converterMadalena() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('MADALENA_SHEETS_ID')) { Logger.log('Ja convertida: ' + props.getProperty('MADALENA_SHEETS_ID')); return; }
  var orig = DriveApp.getFileById('1CxdIXa4mqYsxvLoLXuflMQA3_yHasq3I');
  var pai = orig.getParents().next();
  var novoId = converter(orig);
  var novo = DriveApp.getFileById(novoId);
  novo.setName('FINANCEIRO HILINK MADALENA');
  novo.moveTo(pai);
  ['caroline@hilink.com.br', 'urbano@hilink.com.br', 'clarice@hilink.com.br'].forEach(function (email) {
    UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + novoId + '/permissions?sendNotificationEmail=false', {
      method: 'post', contentType: 'application/json', payload: JSON.stringify({ role: 'writer', type: 'user', emailAddress: email }),
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true
    });
  });
  orig.setName('FINANCEIRO HILINK MADALENA (ANTIGO - NAO EDITAR).xlsx');
  props.setProperty('MADALENA_SHEETS_ID', novoId);
  Logger.log('Nova planilha da Madalena: ' + novo.getUrl());
}

/* ======================================================================================
 * Extratos e francesinhas do banco (13/11/2026)
 *  - "lerBanco": 1) grava no Drive os arquivos enviados pelo Radar (nome padrao, pasta da filial);
 *                2) procura nas pastas fixas da Caroline (PASTAS_BANCO) extratos (OFX/Excel) e francesinhas
 *                   (COBST_..._FRA.TXT) de 2026 que o Radar ainda nao leu e manda para leitura. So le; nao altera nem apaga.
 *  - "instalarGatilhoBanco": roda o lerBanco a cada 15 minutos. Rode uma vez.
 * ====================================================================================== */
var FUNCAO_BANCO = 'https://mdhexsdnavzforuahgxn.supabase.co/functions/v1/banco-arquivos';
var PASTA_DOCUMENTOS = '1qGM7UDxgUnqkuJ0a_kwsUxXpdsV-geOo'; // HILINK - Documentos / {FILIAL} / EXTRATO|FRANCESINHA / {ANO}
var BANCO_NOME_OK = /(^COBST_.*_FRA\.TXT$)|(^FRANCESINHA_)|(EXTRATO)/i;
var BANCO_NOME_FORA = /PGDASD|NEOENERGIA|FRONTEIRA|RETROATIVO|\.pdf$|\.png$|\.jpe?g$/i;
var BANCO_MAX_BYTES = 8 * 1024 * 1024;

function banco(corpo) {
  corpo.token = ScriptApp.getOAuthToken();
  var r = UrlFetchApp.fetch(FUNCAO_BANCO, { method: 'post', contentType: 'application/json', payload: JSON.stringify(corpo), muteHttpExceptions: true });
  var t = r.getContentText();
  try { return JSON.parse(t); } catch (e) { return { ok: false, erro: 'HTTP ' + r.getResponseCode() + ' ' + t.slice(0, 200) }; }
}

function pastaFilha(pai, nome) {
  var it = pai.getFoldersByName(nome);
  return it.hasNext() ? it.next() : pai.createFolder(nome);
}

// Pastas fixas dos arquivos do banco (Caroline):
//  01 - MOVIMENTACAO FINANCEIRA (extratos e OFX, por ano/mes), 02 - FRANCESINHAS (por ano/filial) e HILINK - Documentos (copias do Radar).
// Entra tudo que estiver em subpastas delas, menos pastas de anos anteriores (2025, 2024...).
var PASTAS_BANCO = ['1vnW632w8g1bNOq4ubgEb-L8xqlR6hPHQ', '12qnm83WEIAcniK4g3d1Ye38bJyt_Bh9-', PASTA_DOCUMENTOS];

function driveLista(q, campos) {
  var out = [], pagina = '';
  do {
    var url = 'https://www.googleapis.com/drive/v3/files?pageSize=1000&includeItemsFromAllDrives=true&supportsAllDrives=true' +
      '&fields=' + encodeURIComponent('nextPageToken,' + campos) + '&q=' + encodeURIComponent(q) + (pagina ? '&pageToken=' + pagina : '');
    var r = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (r.getResponseCode() >= 300) throw new Error('lista do Drive: ' + r.getContentText().slice(0, 300));
    var j = JSON.parse(r.getContentText());
    out = out.concat(j.files || []);
    pagina = j.nextPageToken || '';
  } while (pagina);
  return out;
}

function pastasDoBanco() {
  var todas = PASTAS_BANCO.slice(), fila = PASTAS_BANCO.slice();
  while (fila.length) {
    var lote = fila.splice(0, 40);
    var dentro = lote.map(function (id) { return "'" + id + "' in parents"; }).join(' or ');
    driveLista("trashed = false and mimeType = 'application/vnd.google-apps.folder' and (" + dentro + ")", 'files(id,name)').forEach(function (f) {
      if (/(^|\D)20(1\d|2[0-5])(\D|$)/.test(f.name)) return; // pasta de ano anterior
      todas.push(f.id); fila.push(f.id);
    });
  }
  return todas;
}

function lerBanco() {
  var inicio = Date.now();
  var trava = LockService.getScriptLock();
  if (!trava.tryLock(10000)) { Logger.log('Outra leitura em andamento; tenta na proxima rodada.'); return; }
  try {
    // 1) fila do Radar -> Drive
    for (var volta = 0; volta < 5; volta++) {
      var p = banco({ acao: 'pendentes' });
      if (!p.ok) { Logger.log('pendentes: ' + p.erro); break; }
      if (!p.pendentes.length) break;
      var feitos = p.pendentes.map(function (u) {
        try {
          var pasta = pastaFilha(pastaFilha(pastaFilha(DriveApp.getFolderById(PASTA_DOCUMENTOS), u.drive_nome), u.tipo === 'francesinha' ? 'FRANCESINHA' : 'EXTRATO'), String(u.ano));
          var velhos = pasta.getFilesByName(u.nome_drive);
          while (velhos.hasNext()) velhos.next().setTrashed(true);
          var f = pasta.createFile(Utilities.newBlob(Utilities.base64Decode(u.base64), u.mime || 'application/octet-stream', u.nome_drive));
          return { id: u.id, drive_id: f.getId(), url: f.getUrl() };
        } catch (e) { return { id: u.id, erro: String(e).slice(0, 300) }; }
      });
      banco({ acao: 'feito', feitos: feitos });
      Logger.log('Gravados no Drive: ' + feitos.length);
    }
    // 2) Drive -> Radar: so as pastas onde a Caroline guarda os arquivos (e a pasta do Radar), sem varrer o Drive todo
    var pastas = pastasDoBanco(), lista = [];
    for (var k = 0; k < pastas.length; k += 40) {
      var dentro = pastas.slice(k, k + 40).map(function (id) { return "'" + id + "' in parents"; }).join(' or ');
      driveLista("trashed = false and modifiedTime > '2026-01-01T00:00:00' and mimeType != 'application/vnd.google-apps.folder' and (" + dentro + ")",
        'files(id,name,mimeType,size,modifiedTime)').forEach(function (f) {
        if (!BANCO_NOME_OK.test(f.name) || BANCO_NOME_FORA.test(f.name)) return;
        var fr = f.name.match(/^COBST_\w+_\d+_\d{4}(\d{2})P_FRA/i); if (fr && fr[1] !== '26') return; // francesinha de outro ano
        if (!fr && /(^|\D)20(1\d|2[0-5])(\D|$)/.test(f.name) && !/2026/.test(f.name)) return; // extrato de ano anterior
        if (f.mimeType.indexOf('application/vnd.google-apps') === 0 || +f.size > BANCO_MAX_BYTES) return;
        lista.push({ id: f.id, nome: f.name, modificado: f.modifiedTime });
      });
    }
    var meta = {}; lista.forEach(function (x) { meta[x.id] = x; });
    var faltam = [];
    for (var i = 0; i < lista.length; i += 300) {
      var r = banco({ acao: 'quais', arquivos: lista.slice(i, i + 300) });
      if (!r.ok) { Logger.log('quais: ' + r.erro); return; }
      faltam = faltam.concat(r.faltam);
    }
    faltam.sort(function (a, b) { // extratos primeiro, depois francesinhas; mais novos antes
      var fa = /^COBST_/i.test(meta[a].nome) ? 1 : 0, fb = /^COBST_/i.test(meta[b].nome) ? 1 : 0;
      return fa - fb || String(meta[b].modificado).localeCompare(String(meta[a].modificado));
    });
    Logger.log('Arquivos do banco no Drive: ' + lista.length + ' | ainda nao lidos: ' + faltam.length);
    var lote = [], bytes = 0, enviados = 0;
    var mandar = function () {
      if (!lote.length) return;
      var r = banco({ acao: 'gravar', arquivos: lote });
      if (!r.ok) Logger.log('gravar: ' + r.erro);
      else r.arquivos.forEach(function (x) { Logger.log((x.ok ? 'ok  ' : 'ERRO') + ' ' + x.nome + (x.erro ? ' - ' + x.erro : '')); });
      enviados += lote.length; lote = []; bytes = 0;
    };
    for (var j = 0; j < faltam.length; j++) {
      if (Date.now() - inicio > 270000) { Logger.log('Tempo esgotado; continua na proxima rodada.'); break; }
      var m = meta[faltam[j]], blob = DriveApp.getFileById(m.id).getBlob(), b = blob.getBytes();
      if (bytes + b.length > 4 * 1024 * 1024 || lote.length >= 8) mandar();
      lote.push({ id: m.id, nome: m.nome, modificado: m.modificado, mime: blob.getContentType(), base64: Utilities.base64Encode(b) });
      bytes += b.length;
    }
    mandar();
    Logger.log('Enviados para leitura: ' + enviados);
  } finally {
    trava.releaseLock();
  }
}

function instalarGatilhoBanco() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'lerBanco') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('lerBanco').timeBased().everyMinutes(15).create();
  Logger.log('Leitura de extratos e francesinhas a cada 15 minutos.');
}
