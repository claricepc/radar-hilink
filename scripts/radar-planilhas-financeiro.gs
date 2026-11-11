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

function lerPlanilhas() {
  Logger.log('Conta: ' + Session.getActiveUser().getEmail());
  FONTES.forEach(enviar);
}

function enviar(f) {
  var corpo = { filial: f.filial }, tmp = null;
  try {
    var arq = DriveApp.getFileById(f.id);
    corpo.modificado_em = arq.getLastUpdated().toISOString();
    var id = f.id;
    if (f.formato === 'xlsx') { tmp = converter(arq); id = tmp; }
    var ss = SpreadsheetApp.openById(id);
    corpo.abas = ss.getSheets().filter(function (sh) { return ABA_2026.test(sh.getName()); }).map(function (sh) {
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
