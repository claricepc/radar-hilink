/**
 * Envia a planilha de validação da premiação para o Radar Hilink (substitui o Make).
 *
 * Onde colar: na própria planilha, menu Extensões > Apps Script. Apague o que estiver lá e cole este código.
 * Antes de rodar: em Configurações do projeto (engrenagem) > Propriedades do script, crie
 *   Propriedade: PLANILHA_CHAVE
 *   Valor: a mesma chave que você guardou no cofre do Supabase com o nome planilha_chave
 * Depois: escolha a função "instalar" no topo e clique em Executar (uma vez só). Autorize quando o Google pedir.
 * A partir daí a planilha é enviada sozinha de hora em hora.
 */

var URL_RADAR = 'https://mdhexsdnavzforuahgxn.supabase.co/functions/v1/planilha-premiacao';

function enviarPlanilha() {
  var chave = PropertiesService.getScriptProperties().getProperty('PLANILHA_CHAVE');
  if (!chave) throw new Error('Falta a propriedade PLANILHA_CHAVE nas configurações do projeto.');
  var id = SpreadsheetApp.getActiveSpreadsheet().getId();
  var arquivo = UrlFetchApp.fetch('https://docs.google.com/spreadsheets/d/' + id + '/export?format=xlsx', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
  }).getBlob();
  var resp = UrlFetchApp.fetch(URL_RADAR, {
    method: 'post',
    contentType: 'text/plain',
    headers: { 'x-planilha-chave': chave },
    payload: Utilities.base64Encode(arquivo.getBytes()),
    muteHttpExceptions: true
  });
  Logger.log(resp.getResponseCode() + ' ' + resp.getContentText());
  return resp.getContentText();
}

function instalar() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'enviarPlanilha') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('enviarPlanilha').timeBased().everyHours(1).create();
  enviarPlanilha();
}
